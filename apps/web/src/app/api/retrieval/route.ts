import type { NextRequest } from 'next/server';
import type { RetrievalResult } from '@/lib/retrieval/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PostBody {
  text?: string;
  imageBase64?: string;
  topK?: number;
}

/**
 * Retrieval over the local Thingi10K corpus.
 *
 * The indexer (apps/indexer) exposes search() once an index has been
 * built. The import is dynamic so this route doesn't 500 at boot when
 * the indexer isn't built — instead it returns a structured error the
 * UI can show.
 *
 * Per docs/research-claude-sdk.md §5, retrieval runs as a separate
 * orchestration step BEFORE the main agent loop (not as an inline
 * tool), so this route is hit directly by the IntakeWizard rather than
 * mediated through the agent.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as PostBody;

  if (!body.text && !body.imageBase64) {
    return json(400, { message: 'text or imageBase64 required' });
  }

  let indexer: typeof import('@printable/indexer');
  try {
    indexer = await import('@printable/indexer');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(503, {
      message:
        'Retrieval index module failed to load. Run `pnpm --filter @printable/indexer all` to build it first.',
      detail: message,
    });
  }

  try {
    // exactOptionalPropertyTypes: build the query without undefined-valued keys.
    const query: Parameters<typeof indexer.search>[0] = {
      topK: body.topK ?? 6,
    };
    if (body.text) query.text = body.text;
    if (body.imageBase64) query.image = Buffer.from(body.imageBase64, 'base64');

    const raw = await indexer.search(query);
    const results: RetrievalResult[] = raw.map((r) => ({
      modelId: r.id,
      title: r.title,
      description: r.description,
      // Translate manifest-relative paths into the /api/models route
      // that serves files from the on-disk index. The empty-string
      // fallback keeps the UI happy when a model has no thumbnail.
      thumbnailUrl: r.thumbnails?.front
        ? `/api/models/${encodeURIComponent(r.id)}/${encodeURIComponent(r.thumbnails.front)}`
        : '',
      stlUrl: `/api/models/${encodeURIComponent(r.id)}/${encodeURIComponent(r.stlPath)}`,
      score: r.score,
      bboxMm: r.boundingBox,
      license: r.license,
      sourceUrl: r.sourceUrl,
    }));
    return json(200, { results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(503, {
      message:
        'Retrieval failed — the LanceDB index is probably empty. Run `pnpm --filter @printable/indexer all` to download Thingi10K and build the index.',
      detail: message,
    });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
