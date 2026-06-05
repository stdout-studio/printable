/**
 * Studio-mode auth. The shared identity lives on the platform
 * (auth.stdout.studio, Better-Auth on shared Postgres, cookie scoped to
 * .stdout.studio). Rather than pull Postgres/Better-Auth into this public,
 * self-hostable repo, the app validates the session by forwarding the request's
 * cookie to the platform auth service and reading back the user. Keeps self-host
 * free of studio internals; the contract is `GET <STUDIO_AUTH_URL>/api/session`.
 */

import type { AuthProvider, Session } from './types';

const AUTH_URL = process.env.STUDIO_AUTH_URL ?? 'https://auth.stdout.studio';

export const studioAuth: AuthProvider = {
  async getSession(headers: Headers): Promise<Session | null> {
    const cookie = headers.get('cookie');
    if (!cookie) return null;
    try {
      const res = await fetch(`${AUTH_URL}/api/session`, {
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
