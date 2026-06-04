'use client';

import { Loader2, Search, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

interface Props {
  onComplete: () => void;
}

interface RetrievalResult {
  modelId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  stlUrl: string;
  score: number;
  bboxMm: { x: number; y: number; z: number };
}

export function PictureUploadStep({ onComplete }: Props) {
  const [query, setQuery] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<RetrievalResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  function handleFile(file: File) {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(URL.createObjectURL(file));
  }

  async function search() {
    if (!query.trim() && !imagePreview) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch('/api/retrieval', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: query, topK: 6 }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { results: RetrievalResult[] };
      setResults(data.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="max-w-2xl w-full">
      <h3 className="text-xl font-semibold tracking-tight mb-2">From a picture</h3>
      <p className="text-sm text-[var(--color-fg-dim)] mb-6">
        Describe what you want, optionally with a reference photo. We&apos;ll find a close match
        from a 100K-model corpus to start from, then edit it together.
      </p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder='e.g. "phone stand with cable channel"'
        className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm mb-3 focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20"
      />

      <label className="block border-2 border-dashed border-[var(--color-border)] rounded-2xl p-6 text-center cursor-pointer hover:border-[var(--color-accent)]">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {imagePreview ? (
          <div className="relative inline-block">
            <Image
              src={imagePreview}
              alt="reference"
              width={240}
              height={160}
              className="max-h-40 mx-auto rounded-lg object-contain"
              unoptimized
            />
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                URL.revokeObjectURL(imagePreview);
                setImagePreview(null);
              }}
              className="absolute -top-2 -right-2 p-1 rounded-full bg-white border border-[var(--color-border)]"
              aria-label="Remove image"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <>
            <Upload size={24} className="mx-auto mb-2 text-[var(--color-fg-dim)]" />
            <p className="text-sm">Drop a reference photo (optional)</p>
          </>
        )}
      </label>

      <button
        onClick={() => void search()}
        disabled={(!query.trim() && !imagePreview) || searching}
        className="mt-4 w-full rounded-xl bg-[var(--color-accent)] text-white py-2.5 disabled:opacity-40 flex items-center justify-center gap-2"
      >
        {searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
        Find a starting point
      </button>

      {error && (
        <p className="mt-3 text-sm text-red-600 break-all">
          {error}
          {error.includes('404') || error.includes('index')
            ? ' — the retrieval index hasn\'t been built yet. Run `pnpm --filter @printable/indexer all`, or skip below.'
            : ''}
        </p>
      )}

      {results.length > 0 && (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {results.map((r) => (
            <button
              key={r.modelId}
              className="border border-[var(--color-border)] rounded-xl p-2 text-left hover:border-[var(--color-accent)]"
              onClick={onComplete}
            >
              <Image
                src={r.thumbnailUrl}
                alt={r.title}
                width={200}
                height={200}
                className="w-full aspect-square object-cover rounded-md mb-2"
                unoptimized
              />
              <p className="text-xs font-medium truncate">{r.title}</p>
              <p className="text-[10px] text-[var(--color-fg-dim)]">
                {r.bboxMm.x.toFixed(0)}×{r.bboxMm.y.toFixed(0)}×{r.bboxMm.z.toFixed(0)} mm
              </p>
            </button>
          ))}
        </div>
      )}

      <button
        onClick={onComplete}
        className="mt-3 w-full text-sm text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] py-2"
      >
        Skip and describe in chat instead
      </button>
    </div>
  );
}
