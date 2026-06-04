/**
 * Client for the SLICE-100K (Thingi10K) retrieval index.
 *
 * The index lives on disk under apps/indexer/data/ and is queried via
 * @printable/indexer's `search()` function. This client is the bridge
 * for browser-side code: it POSTs to /api/retrieval and unpacks the
 * results into a UI-friendly shape (URLs to servable assets, no raw
 * filesystem paths leak through).
 */

export interface RetrievalResult {
  modelId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  stlUrl: string;
  score: number;
  bboxMm: { x: number; y: number; z: number };
  license: string;
  sourceUrl: string;
}

export interface RetrievalQuery {
  text?: string;
  imageBase64?: string;
  topK?: number;
}

/**
 * Retrieve top-K base models for an intake query. Used by the
 * IntakeWizard when the user picks from_picture or from_scratch — per
 * docs/research-claude-sdk.md §5, retrieval runs as a separate
 * orchestration step BEFORE the main agent loop.
 *
 * In server-side code (API routes, server components) this can also be
 * called directly because the underlying POST handler is a Node
 * runtime route. Browser-side code goes through fetch.
 */
export async function retrieveBaseModels(
  query: { text: string; topK?: number; imageBase64?: string },
): Promise<RetrievalResult[]> {
  const body: Record<string, unknown> = { text: query.text };
  if (typeof query.topK === 'number') body['topK'] = query.topK;
  if (query.imageBase64) body['imageBase64'] = query.imageBase64;

  const res = await fetch('/api/retrieval', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/retrieval ${res.status}: ${text || res.statusText}`);
  }
  const data = (await res.json()) as { results?: RetrievalResult[] };
  return data.results ?? [];
}
