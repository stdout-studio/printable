'use client';

import { useViewMode } from './ViewMode';
import { clsx } from 'clsx';

/**
 * Two-tab segmented control. "Try it" is the default; "Self-host" reveals
 * the GitHub install path. Lives in the landing header.
 */
export function ModeToggle() {
  const { mode, setMode } = useViewMode();
  return (
    <div className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-1 text-sm">
      <button
        type="button"
        onClick={() => setMode('hosted')}
        className={clsx(
          'px-4 py-1.5 rounded-full transition-colors',
          mode === 'hosted'
            ? 'bg-[var(--color-fg)] text-[var(--color-bg)]'
            : 'text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]',
        )}
      >
        Try it
      </button>
      <button
        type="button"
        onClick={() => setMode('selfhost')}
        className={clsx(
          'px-4 py-1.5 rounded-full transition-colors',
          mode === 'selfhost'
            ? 'bg-[var(--color-fg)] text-[var(--color-bg)]'
            : 'text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]',
        )}
      >
        Self-host
      </button>
    </div>
  );
}
