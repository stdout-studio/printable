'use client';

import type { ReactNode } from 'react';
import { ViewModeProvider } from './ViewMode';
import { Header } from './Header';
import { Footer } from './Footer';

/**
 * Wraps a landing page with the standardized header (logo + mode toggle +
 * login) and footer (legal links + GitHub).
 *
 * Pages compose their own body content; the shell provides the chrome.
 */
export function LandingShell({ children }: { children: ReactNode }) {
  return (
    <ViewModeProvider>
      <div className="min-h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </div>
    </ViewModeProvider>
  );
}
