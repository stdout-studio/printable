/**
 * Hosted-mode auth. The shared identity lives on the platform backend (a
 * Better-Auth service on shared Postgres, with a session cookie scoped to the
 * parent domain). Rather than pull Postgres/Better-Auth into this public,
 * self-hostable repo, the app validates the session by forwarding the request's
 * cookie to the platform and reading back the user — keeping self-host free of
 * platform internals. Contract: `GET <HOSTED_AUTH_URL>/api/session`.
 */

import type { AuthProvider, Session } from './types';

export const hostedAuth: AuthProvider = {
  async getSession(headers: Headers): Promise<Session | null> {
    const authUrl = process.env.HOSTED_AUTH_URL ?? '';
    const cookie = headers.get('cookie');
    if (!cookie || !authUrl) return null;
    try {
      const res = await fetch(`${authUrl}/api/session`, {
        headers: { cookie },
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        user?: { id?: string; email?: string; name?: string | null; createdAt?: string };
        expiresAt?: string;
      } | null;
      if (!data?.user?.id || !data.user.email || !data.expiresAt) return null;
      return {
        user: {
          id: data.user.id,
          email: data.user.email,
          name: data.user.name ?? null,
          createdAt: data.user.createdAt ?? new Date().toISOString(),
        },
        expiresAt: data.expiresAt,
      };
    } catch {
      return null;
    }
  },

  async hasAnyUser() {
    // Multi-tenant: signups are always open; the local setup wizard never runs.
    return true;
  },
};
