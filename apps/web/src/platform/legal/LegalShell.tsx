import type { ReactNode } from 'react';
import Link from 'next/link';
import { appConfig } from '../app-config';

/**
 * Shared chrome for legal pages — back-link to landing, title, prose
 * container with sensible defaults. Per-page body is just children.
 */
export function LegalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-fg)]">
      <header className="px-6 py-4 border-b border-[var(--color-border)]">
        <Link
          href="/"
          className="text-sm text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
        >
          ← {appConfig.name}
        </Link>
      </header>
      <main className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight mb-8">{title}</h1>
        <div className="prose-content text-[var(--color-fg)] leading-relaxed [&>h2]:text-xl [&>h2]:font-semibold [&>h2]:mt-8 [&>h2]:mb-3 [&>p]:mb-4 [&>p]:text-[var(--color-fg-dim)] [&>ul]:mb-4 [&>ul]:list-disc [&>ul]:pl-6 [&>ul]:text-[var(--color-fg-dim)] [&>ul>li]:mb-1">
          {children}
        </div>
      </main>
    </div>
  );
}
