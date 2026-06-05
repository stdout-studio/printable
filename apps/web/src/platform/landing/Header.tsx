'use client';

import Link from 'next/link';
import { ModeToggle } from './ModeToggle';
import { appConfig } from '../app-config';
import { BrandMark } from '../BrandMark';

/**
 * Landing-page header: app name on the left, mode toggle + login link
 * on the right. Sticky.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-50 backdrop-blur-md border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-bg)_85%,transparent)]">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-base lowercase">
          <BrandMark size={18} />
          {appConfig.name}
        </Link>
        <div className="flex items-center gap-4">
          <ModeToggle />
          <Link
            href="/login"
            className="text-sm text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] transition-colors"
          >
            Log in
          </Link>
        </div>
      </div>
    </header>
  );
}
