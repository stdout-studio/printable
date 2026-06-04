# Printable — Corpus Acquisition & Indexing Architecture

Decision date: 2026-05-28. Opinionated, no fence-sitting.

## Recommended corpus

**Primary: the Thingiverse subset of Objaverse-XL (~3.5M STL files), license-gated to CC-BY / CC-BY-SA / CC0.** Bootstrap with **SLICE-100K** (100k STLs from the same branch, already pre-rendered with 10-view ortho+iso images and LVIS captions, CC-BY-4.0).

Rejected:
- **Printables.com.** No public API; community CLIs exist but ToS forbids "non-standard use" and scraping invites IP blocks.
- **Thingiverse direct API.** OAuth + Swagger docs but single-digit req/s in practice and ToS restricts bulk redistribution. Unnecessary — Objaverse-XL already mirrors it under ODC-By with per-object licenses preserved.
- **MyMiniFactory / Cults3D.** APIs deliberately do not serve 3D files, only thumbnails + metadata.
- **GrabCAD.** ToS forbids redistribution; no public API.
- **Objaverse-XL non-Thingiverse sources** (GitHub, Sketchfab, Polycam, Smithsonian). Mostly textured GLBs, not printable STLs.

## Acquisition plan

1. `objaverse` PyPI package in `scripts/ingest/` (Python boundary for ingest; TS for the app; both write to the same Lance dataset).
2. Pull annotations via `oxl.get_annotations()`. Filter `source=="thingiverse"`, `fileType=="stl"`, license in `{CC0, CC-BY, CC-BY-SA}`. Expected ~2.5M of 3.5M survive.
3. Pull SLICE-100K from Figshare (single archive, no rate limit) as demo bootstrap.
4. STLs from the Objaverse-XL S3 mirror (SHA-256-keyed, deduplicated), not Thingiverse direct — zero rate-limit exposure. Library parallelizes; ~50 MB/s on a fat pipe.
5. Render 3-view ortho PNGs for the gap using headless Blender via `bpy` (Objaverse-XL ships the renderer).
6. Fill missing captions with `claude-haiku-4` over front render + creator title/description (rides along in Objaverse-XL `metadata`).

**Legal posture.** ODC-By + per-object CC-BY filter. We redistribute derivative renders + embeddings only, never republish STLs — at serve time we link the Objaverse mirror with attribution. Same posture as SLICE-100K and Objaverse++; unchallenged.

**Timeline.** Demo: SLICE-100K only, 100k models, ~80 GB, indexed in ~2 days. Month 1: filtered Objaverse-XL Thingiverse, ~2.5M STLs, ~3 TB, ~7 days rendering on 8x cloud GPUs. Quarter 1: optional Printables CC-BY scrape behind rotating IPs.

## Embedding model

**`voyage-multimodal-3.5`** — 1024-dim, 32k context, $0.12/M tokens, unified transformer over interleaved text+image. Beats Cohere Embed v4 by ~4.6% on visual document retrieval, and unlike CLIP it embeds text+image jointly into one vector — exactly the query shape ("description + reference photo + dims").

Rejected: text-embedding-3-large (text-only, two-tower hack); Cohere Embed v4 (close, behind on visual); CLIP ViT-L/14 (ships with Objaverse-XL but weak on long descriptive text). No production-grade 3D-native embedding exists in May 2026 — geometric ones (PointBERT, Uni3D) need point clouds we don't have at scale.

## Vector store

**LanceDB.** In-process, Lance columnar file format, native TS SDK, disk-backed IVF-PQ scales past RAM, ~150 MB resident at 1M vectors. sqlite-vec is the runner-up but forces manual index tuning and has a weaker multimodal/blob story; Qdrant adds a server we don't want; Chroma can't index past RAM. LanceDB stores blobs (renderings), metadata, and vectors in one table — one file, one mental model.

## Embedded record schema

```typescript
interface PrintableModel {
  id: string;                    // sha256 of STL (matches Objaverse-XL key)
  source: "objaverse-thingiverse" | "slice-100k" | "printables";
  sourceUrl: string;             // upstream link for attribution
  license: "CC0" | "CC-BY" | "CC-BY-SA" | "CC-BY-4.0";
  author: string;

  // text signal
  title: string;
  description: string;           // original creator text
  tags: string[];
  llmCaption: string;            // claude-haiku-generated, fills gaps

  // geometry signal
  boundingBox: { x: number; y: number; z: number };  // mm
  volume: number;                // mm^3
  triCount: number;
  isWatertight: boolean;
  lvisCategory?: string[];       // top-3 from SLICE-100K when present

  // render signal
  thumbnails: { front: string; side: string; top: string; iso: string };  // S3 paths

  // the embedding
  embedding: number[];           // 1024-dim voyage-multimodal-3.5 over (renders ⊕ title ⊕ description ⊕ tags ⊕ llmCaption)
  embeddingModel: "voyage-multimodal-3.5";
  embeddedAt: string;            // ISO8601
}
```

One vector per model. Compose the embedding input by interleaving the front render, title, description, and bounding-box-as-text ("120×80×35 mm") — voyage-multimodal-3.5 is built for exactly this shape.

## Bootstrap path — demo this week

1. Day 1: download SLICE-100K archive from Figshare; extract STLs, renderings, captions.
2. Day 2: embed 100k records with voyage-multimodal-3.5 (~$15 at $0.12/M; well inside the 200M-token free tier). Write Lance dataset.
3. Day 3: TS query endpoint — text (+ optional image, + optional dims-as-text) → voyage-multimodal-3.5 → LanceDB top-20 → STL URLs + thumbnails.
4. Day 4: hand off to the AI-edit step.
5. Day 5: demo.

This avoids every scraping / legal / rate-limit headache for v1 while running the exact same schema and pipeline that will scale to 2.5M in month 1. Structural choice: do not build a Thingiverse or Printables scraper for the demo — the curated dataset already exists.
