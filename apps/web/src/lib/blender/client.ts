/**
 * HTTP client for the Blender worker.
 * Endpoints per docs/research-blender-worker.md §3 and the actual routes
 * in apps/blender-worker/src/main.py.
 *
 * Session lifecycle is lazy — the first call that needs a worker session
 * creates one, subsequent calls reuse it. When the worker is unreachable,
 * every call degrades to a structured mock that tells Claude the worker
 * is offline rather than fabricating a result.
 */

/** The agent's tool input IS the operation object — discriminated by `type`.
 *  We just translate meshId before forwarding to the worker. */
export interface ApplyOperationInput extends Record<string, unknown> {
  type: string;
  meshId: string;
}

export interface RenderPreviewInput {
  /** Named camera angle the agent asked for — matches the render_preview tool's
   *  `cameraPreset` enum (front/back/left/right/top/bottom/iso/current). These
   *  are the exact keys the agent emits; forward them verbatim so the worker
   *  honours the requested angle instead of always falling back to 'iso'. */
  cameraPreset?: string;
  style?: string;
  showAxes?: boolean;
  orthographic?: boolean;
}

export interface MeasureInput {
  kind: string;
  fromPointId?: string;
  toPointId?: string;
  direction?: [number, number, number];
  expectedVoidMm?: number;
  meshId?: string;
}

const CALL_TIMEOUT_MS = 30_000;

export class BlenderClient {
  private sessionIdPromise: Promise<string> | null = null;
  /** web mesh id -> worker mesh id, populated by the caller from the
   *  session's MeshHandle list. Lets the agent reference web mesh ids while
   *  we transparently translate at the wire. */
  private readonly meshIdMap: Map<string, string>;

  constructor(
    private readonly baseUrl: string,
    workerSessionId: string | null = null,
    meshIdMap: Record<string, string> = {},
  ) {
    if (workerSessionId) {
      this.sessionIdPromise = Promise.resolve(workerSessionId);
    }
    this.meshIdMap = new Map(Object.entries(meshIdMap));
  }

  /** Lazy session-create; cached for the lifetime of this client instance.
   *  Returns null if the worker is unreachable. */
  private async ensureSession(): Promise<string | null> {
    if (this.sessionIdPromise) {
      try {
        return await this.sessionIdPromise;
      } catch {
        this.sessionIdPromise = null;
      }
    }
    this.sessionIdPromise = this.createSession();
    try {
      return await this.sessionIdPromise;
    } catch {
      this.sessionIdPromise = null;
      return null;
    }
  }

  private async createSession(): Promise<string> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`worker POST /sessions returned ${res.status}`);
    const body = (await res.json()) as { sessionId: string };
    return body.sessionId;
  }

  private translateMeshId(id: string): string {
    return this.meshIdMap.get(id) ?? id;
  }

  /** Reverse lookup: worker mesh id → web mesh id. Used when the agent
   *  passes the worker id directly (e.g. after inspect_scene), so we can
   *  emit mesh_updated under the right web key for the viewer. */
  reverseTranslateMeshId(id: string): string {
    for (const [webId, workerId] of this.meshIdMap.entries()) {
      if (workerId === id) return webId;
    }
    return id;
  }

  async applyOperation(input: ApplyOperationInput): Promise<unknown> {
    return this.sessionCall(
      input,
      (sid) => `/sessions/${sid}/apply_operation`,
      (i) => ({
        // Forward the full op object — its shape matches the worker's
        // Pydantic Operation union exactly. Only the meshId needs to be
        // remapped from the web id to the worker id.
        op: { ...i, meshId: this.translateMeshId(i.meshId) },
      }),
      {
        mocked: true,
        reason: 'blender worker not deployed yet',
        echo: input,
        diff_summary: 'no-op (mock)',
        warnings: ['Worker offline — describe the intended change in chat.'],
      },
    );
  }

  async renderPreview(input: RenderPreviewInput): Promise<unknown> {
    return this.sessionCall(
      input,
      (sid) => `/sessions/${sid}/render_preview`,
      (i) => ({
        cameraPreset: i.cameraPreset ?? 'iso',
        style: i.style ?? 'solid_engineering',
        showAxes: i.showAxes ?? true,
        orthographic: i.orthographic ?? true,
        width: 1024,
        height: 1024,
      }),
      {
        mocked: true,
        reason: 'blender worker not deployed yet',
        message:
          'No render available. Describe what the user would see and ask them to confirm in plain language.',
      },
    );
  }

  async measure(input: MeasureInput): Promise<unknown> {
    return this.sessionCall(
      input,
      (sid) => `/sessions/${sid}/measure`,
      // Forward the agent's camelCase keys verbatim (the worker accepts them
      // via Pydantic aliases). Only meshId needs web→worker translation.
      (i) => ({
        ...i,
        ...(i.meshId ? { meshId: this.translateMeshId(i.meshId) } : {}),
      }),
      {
        mocked: true,
        reason: 'blender worker not deployed yet',
        message: 'No measurement available. Reason from the user-clicked point positions instead.',
      },
    );
  }

  async inspectScene(): Promise<unknown> {
    return this.sessionCall(
      {},
      (sid) => `/sessions/${sid}/inspect_scene`,
      () => ({}),
      { mocked: true, reason: 'blender worker not deployed yet' },
    );
  }

  async inspectObject(input: { nameOrId: string }): Promise<unknown> {
    // Translate web mesh id → worker mesh id if it maps.
    const nameOrId = this.translateMeshId(input.nameOrId);
    return this.sessionCall(
      { nameOrId },
      (sid) => `/sessions/${sid}/inspect_object`,
      (i) => ({ nameOrId: i.nameOrId }),
      { mocked: true, reason: 'blender worker not deployed yet' },
    );
  }

  async raycast(input: {
    origin: [number, number, number];
    direction: [number, number, number];
    meshId?: string;
  }): Promise<unknown> {
    return this.sessionCall(
      input,
      (sid) => `/sessions/${sid}/raycast`,
      (i) => ({
        origin: i.origin,
        direction: i.direction,
        ...(i.meshId ? { meshId: this.translateMeshId(i.meshId) } : {}),
      }),
      { mocked: true, reason: 'blender worker not deployed yet' },
    );
  }

  /** Export the current state of a mesh as a binary STL (base64).
   *  Used after every successful apply_operation so the viewer can refresh.
   *  Worker schema: `{ selection?: string[] }` — selection is the list of
   *  object IDs; omitted = the worker's active mesh. */
  async exportStl(webMeshId: string): Promise<unknown> {
    const workerMeshId = this.translateMeshId(webMeshId);
    return this.sessionCall(
      { workerMeshId },
      (sid) => `/sessions/${sid}/export_stl`,
      (i) => ({ selection: [i.workerMeshId] }),
      {
        mocked: true,
        reason: 'blender worker not deployed yet',
      },
    );
  }

  private async sessionCall<I>(
    input: I,
    pathFor: (sessionId: string) => string,
    body: (input: I) => unknown,
    offlineMock: Record<string, unknown>,
  ): Promise<unknown> {
    const sessionId = await this.ensureSession();
    if (!sessionId) {
      return { ...offlineMock, worker_status: 'unreachable' };
    }
    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}${pathFor(sessionId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body(input)),
      });
      if (res.status === 404) {
        // Session no longer exists on the worker (worker was restarted /
        // session GC'd / etc). Be EXPLICIT about this so the agent doesn't
        // confuse it with "worker offline" and tell the user to start their
        // worker — the worker is fine, but the cached mesh state is gone.
        const detail = await res.text().catch(() => '');
        // Invalidate the cached session id so next call mints a new one.
        this.sessionIdPromise = null;
        return {
          session_expired: true,
          stale_session_id: sessionId,
          reason:
            'The Blender worker is up, but the session that held the imported mesh no longer exists (likely because the worker was restarted). The user must reload the page and re-upload their part to recover.',
          worker_response: detail.slice(0, 500),
        };
      }
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return {
          worker_error: true,
          status: res.status,
          detail: detail.slice(0, 500),
          reason: `Worker returned HTTP ${res.status}. The operation did NOT happen.`,
        };
      }
      return await res.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ...offlineMock, worker_status: `unreachable (${message})` };
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
