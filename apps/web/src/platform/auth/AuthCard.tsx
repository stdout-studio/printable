'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { appConfig } from '../app-config';

/**
 * Shared visual chrome for /login, /signup, /setup. Centered card with
 * the app's name at the top.
 */
export function AuthCard({
  title,
  subtitle,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
      <header className="px-6 py-4">
        <Link href="/" className="font-semibold tracking-tight">
          {appConfig.name}
        </Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight mb-2">{title}</h1>
          {subtitle && (
            <p className="text-sm text-[var(--color-fg-dim)] mb-8 leading-relaxed">
              {subtitle}
            </p>
          )}
          {!subtitle && <div className="mb-6" />}
          {children}
          {footer && <div className="mt-8 text-sm text-center">{footer}</div>}
        </div>
      </main>
    </div>
  );
}

export function FormField({
  label,
  type,
  name,
  required,
  autoComplete,
  placeholder,
}: {
  label: string;
  type: string;
  name: string;
  required?: boolean;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-medium mb-1.5">{label}</span>
      <input
        type={type}
        name={name}
        required={required}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[var(--color-fg)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
      />
    </label>
  );
}

export function SubmitButton({ children, pending }: { children: ReactNode; pending?: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-[var(--color-fg)] text-[var(--color-bg)] px-4 py-2.5 font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
    >
      {pending ? 'Working…' : children}
    </button>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mb-4 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-sm text-red-600 dark:text-red-400">
      {message}
    </div>
  );
}
