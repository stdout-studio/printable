'use client';

import { SelfHostOnly } from './ViewMode';
import { appConfig } from '../app-config';

/**
 * Detailed self-host setup steps, shown only in self-host view mode.
 * Anchored at #self-host-details so the hero CTA can link to it.
 */
export function SelfHostGuide() {
  return (
    <SelfHostOnly>
      <section id="self-host-details" className="px-6 py-16 scroll-mt-20">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-semibold tracking-tight mb-2">
            Run it on your own machine
          </h2>
          <p className="text-[var(--color-fg-dim)] mb-10 leading-relaxed">
            Five minutes if you have Docker. Setup wizard handles passwords,
            API keys, everything. SQLite + local files — no cloud anything.
          </p>

          <ol className="space-y-6">
            <Step
              n={1}
              title="Clone & run"
              body={
                <pre className="font-mono text-sm bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded-lg p-4 overflow-x-auto">
{appConfig.selfHostCommand}
                </pre>
              }
            />
            <Step
              n={2}
              title="Open the setup wizard"
              body={
                <p className="text-[var(--color-fg-dim)] leading-relaxed">
                  Once the containers are up, hit{' '}
                  <code className="bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded px-1.5 py-0.5 font-mono text-[0.85em]">
                    http://localhost:3000/setup
                  </code>{' '}
                  in your browser. The wizard walks you through your admin
                  email + password, then asks for the API keys this app needs.
                </p>
              }
            />
            <Step
              n={3}
              title="Provide your API keys"
              body={
                <div className="space-y-3">
                  {appConfig.requiredEnvVars.map((env) => (
                    <div
                      key={env.key}
                      className="border border-[var(--color-border)] bg-[var(--color-bg-elev)] rounded-lg p-4"
                    >
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className="font-mono text-sm">{env.key}</span>
                        <span className="text-xs text-[var(--color-fg-dim)]">
                          {env.required ? 'required' : 'optional'}
                        </span>
                      </div>
                      <p className="text-sm text-[var(--color-fg-dim)] leading-relaxed">
                        {env.description}
                        {env.helpUrl && (
                          <>
                            {' '}
                            <a
                              href={env.helpUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--color-accent)] hover:underline"
                            >
                              Get one →
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              }
            />
            <Step
              n={4}
              title="(Optional) Make it public"
              body={
                <p className="text-[var(--color-fg-dim)] leading-relaxed">
                  If you want others to be able to reach your instance, point
                  a domain at it and set{' '}
                  <code className="bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded px-1.5 py-0.5 font-mono text-[0.85em]">
                    PUBLIC_URL=https://your-domain.com
                  </code>
                  . By default new signups are off — flip{' '}
                  <code className="bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded px-1.5 py-0.5 font-mono text-[0.85em]">
                    STDOUT_ALLOW_SIGNUPS=true
                  </code>{' '}
                  in your env to open them. Reset passwords from the admin
                  user's account settings.
                </p>
              }
            />
          </ol>
        </div>
      </section>
    </SelfHostOnly>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: React.ReactNode }) {
  return (
    <li className="flex gap-5">
      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-[var(--color-fg)] text-[var(--color-bg)] flex items-center justify-center font-semibold text-sm">
        {n}
      </div>
      <div className="flex-1 pt-1">
        <h3 className="font-semibold text-lg mb-3">{title}</h3>
        {body}
      </div>
    </li>
  );
}
