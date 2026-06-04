'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/platform/auth/client';
import { AuthCard, FormField, SubmitButton, ErrorBox } from '@/platform/auth/AuthCard';
import { appConfig } from '@/platform/app-config';

export interface EnvStatus {
  key: string;
  label: string;
  description: string;
  required: boolean;
  helpUrl: string | null;
  present: boolean;
}

export function SetupWizard({ envStatus }: { envStatus: EnvStatus[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingRequired = envStatus.filter((e) => e.required && !e.present);
  const presentCount = envStatus.filter((e) => e.present).length;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const data = new FormData(e.currentTarget);
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');
    const name = String(data.get('name') ?? '');
    try {
      const res = await authClient.signUp.email({ email, password, name });
      if (res.error) {
        setError(res.error.message ?? 'Could not create admin account.');
        setPending(false);
        return;
      }
      router.push('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error.');
      setPending(false);
    }
  }

  return (
    <AuthCard
      title={`Set up ${appConfig.name}`}
      subtitle="First-run setup. Creates your admin account and walks you through the API keys this app needs."
    >
      {/* Env var checklist */}
      <div className="mb-8 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold">API keys</h2>
          <span className="text-xs text-[var(--color-fg-dim)]">
            {presentCount} of {envStatus.length} present
          </span>
        </div>
        <ul className="space-y-3">
          {envStatus.map((env) => (
            <li key={env.key} className="flex gap-3 items-start">
              <span
                className={`mt-0.5 inline-flex w-4 h-4 rounded-full items-center justify-center text-[10px] flex-shrink-0 ${
                  env.present
                    ? 'bg-green-500/20 text-green-700 dark:text-green-400'
                    : env.required
                      ? 'bg-red-500/20 text-red-700 dark:text-red-400'
                      : 'bg-[var(--color-border)] text-[var(--color-fg-dim)]'
                }`}
              >
                {env.present ? '✓' : env.required ? '!' : '·'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <code className="font-mono text-xs">{env.key}</code>
                  {!env.required && (
                    <span className="text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
                      optional
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-fg-dim)] leading-relaxed mt-0.5">
                  {env.description}
                  {env.helpUrl && !env.present && (
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
            </li>
          ))}
        </ul>
        {missingRequired.length > 0 && (
          <p className="mt-4 text-xs text-[var(--color-fg-dim)] leading-relaxed">
            Set the missing keys in your <code className="font-mono">.env</code> file and restart
            the container. You can also continue setup and add them later — the app will degrade
            gracefully (features that need a missing key will say so).
          </p>
        )}
      </div>

      {/* Admin account form */}
      <h2 className="text-sm font-semibold mb-3">Admin account</h2>
      <form onSubmit={handleSubmit}>
        {error && <ErrorBox message={error} />}
        <FormField
          label="Name"
          type="text"
          name="name"
          required
          autoComplete="name"
          placeholder="Your name"
        />
        <FormField
          label="Email"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
        />
        <FormField
          label="Password"
          type="password"
          name="password"
          required
          autoComplete="new-password"
        />
        <SubmitButton pending={pending}>Create admin & continue</SubmitButton>
      </form>
    </AuthCard>
  );
}
