'use client';

import Link from 'next/link';
import { appConfig } from '../app-config';
import { GitHubMark } from './icons';

/**
 * Footer with legal links. Kept minimal — Impressum / Privacy / Terms
 * are the required-by-German-law set; GitHub link reaffirms the
 * self-host option for casual visitors.
 */
export function Footer() {
  return (
    <footer className="border-t border-[var(--color-border)] mt-24">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="text-sm text-[var(--color-fg-dim)] leading-relaxed">
          <div className="font-semibold text-[var(--color-fg)] mb-1">{appConfig.name}</div>
          <div>Open source · MIT licensed.</div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <Link
            href="/impressum"
            className="text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors"
          >
            Impressum
          </Link>
          <Link
            href="/privacy"
            className="text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors"
          >
            Privacy
          </Link>
          <Link
            href="/terms"
            className="text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors"
          >
            Terms
          </Link>
          <a
            href={appConfig.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors"
          >
            <GitHubMark className="w-4 h-4" />
            GitHub
          </a>
        </div>
      </div>
    </footer>
  );
}
