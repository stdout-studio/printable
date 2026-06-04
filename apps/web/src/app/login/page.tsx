'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/platform/auth/client';
import { AuthCard, FormField, SubmitButton, ErrorBox } from '@/platform/auth/AuthCard';
import { appConfig } from '@/platform/app-config';

export default function LoginPage() {
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
    try {
      const res = await authClient.signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? 'Login failed.');
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
      title={`Log in to ${appConfig.name}`}
      subtitle="Welcome back."
      footer={
        <span className="text-[var(--color-fg-dim)]">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-[var(--color-fg)] hover:underline">
            Sign up
          </Link>
        </span>
      }
    >
      <form onSubmit={handleSubmit}>
        {error && <ErrorBox message={error} />}
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
          autoComplete="current-password"
        />
        <SubmitButton pending={pending}>Log in</SubmitButton>
      </form>
    </AuthCard>
  );
}
