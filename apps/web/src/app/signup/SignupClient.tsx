'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/platform/auth/client';
import { AuthCard, FormField, SubmitButton, ErrorBox } from '@/platform/auth/AuthCard';
import { appConfig } from '@/platform/app-config';

export default function SignupClient() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        // The most common case: signups are disabled. Better-Auth returns
        // a specific code; we surface a friendly message either way.
        const msg = res.error.message ?? 'Sign-up failed.';
        if (/disable|closed|not allowed/i.test(msg)) {
          setError(
            'Sign-ups are closed on this instance. If you self-host and want to open them, set STDOUT_ALLOW_SIGNUPS=true.',
          );
        } else {
          setError(msg);
        }
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
      title={`Create your ${appConfig.name} account`}
      footer={
        <span className="text-[var(--color-fg-dim)]">
          Already have one?{' '}
          <Link href="/login" className="text-[var(--color-fg)] hover:underline">
            Log in
          </Link>
        </span>
      }
    >
      <form onSubmit={handleSubmit}>
        {error && <ErrorBox message={error} />}
        <FormField
          label="Name"
          type="text"
          name="name"
          required
          autoComplete="name"
          placeholder="Ada Lovelace"
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
        <SubmitButton pending={pending}>Create account</SubmitButton>
      </form>
    </AuthCard>
  );
}
