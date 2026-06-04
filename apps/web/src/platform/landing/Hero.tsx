'use client';

import Link from 'next/link';
import { HostedOnly, SelfHostOnly } from './ViewMode';
import { appConfig } from '../app-config';
import { GitHubMark } from './icons';

/**
 * The hero. Big tagline, supporting paragraph, and a CTA that switches
 * based on view mode — "Try it out" for hosted users, the GitHub clone
 * command for self-hosters.
 */
export function Hero() {
  return (
    <section className="px-6 pt-20 pb-14">
      <div className="max-w-3xl mx-auto text-center">
        <h1 className="text-5xl md:text-6xl font-semibold tracking-tight leading-[1.05] mb-6">
          {appConfig.tagline}
        </h1>
        <p className="text-lg md:text-xl text-[var(--color-fg-dim)] mb-10 max-w-2xl mx-auto leading-relaxed">
          {appConfig.description}
        </p>

        <HostedOnly>
          <div className="flex items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-fg)] text-[var(--color-bg)] px-6 py-3 text-base font-medium hover:opacity-90 transition-opacity"
            >
              Try {appConfig.name}
              <span aria-hidden>→</span>
            </Link>
            <Link
              href="/login"
              className="text-base text-[var(--color-fg-dim)] hover:text-[var(--color-fg)] px-4 py-3"
            >
              I have an account
            </Link>
          </div>
        </HostedOnly>

        <SelfHostOnly>
          <SelfHostHeroCTA />
        </SelfHostOnly>
      </div>
    </section>
  );
}

function SelfHostHeroCTA() {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-6 text-left">
        <div className="flex items-center gap-2 mb-3 text-sm text-[var(--color-fg-dim)]">
          <GitHubMark className="w-4 h-4" />
          <span>Spin it up on your own machine</span>
        </div>
        <pre className="font-mono text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg p-4 overflow-x-auto">
{appConfig.selfHostCommand}
        </pre>
        <p className="mt-4 text-sm text-[var(--color-fg-dim)] leading-relaxed">
          The setup wizard walks you through API keys and your admin password
          on first boot. SQLite, local file storage, no external services —
          everything stays on your box.
        </p>
        <div className="mt-5 flex items-center gap-4">
          <a
            href={appConfig.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--color-fg)] text-[var(--color-bg)] px-5 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <GitHubMark className="w-4 h-4" />
            View on GitHub
          </a>
          <Link
            href="#self-host-details"
            className="text-sm text-[var(--color-fg-dim)] hover:text-[var(--color-fg)]"
          >
            Read the setup guide ↓
          </Link>
        </div>
      </div>
    </div>
  );
}
