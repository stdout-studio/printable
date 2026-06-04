/**
 * Auth provider interface. Both local mode (SQLite + email/password) and
 * studio mode (Better-Auth + Google SSO + shared Postgres) implement this.
 *
 * The interface is intentionally minimal — Better-Auth handles most of
 * the heavy lifting; we only abstract what the app surface needs.
 */

export interface User {
  id: string;
  email: string;
  name: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** Whether this user is the local-mode admin (only meaningful for local). */
  isAdmin?: boolean;
}

export interface Session {
  user: User;
  expiresAt: string;
}

export interface AuthProvider {
  /** Get the current session from request cookies/headers. Returns null if
   *  no session or session is expired/invalid. */
  getSession(headers: Headers): Promise<Session | null>;

  /** Whether any user exists in the system. Used by /setup to detect
   *  first-run state in local mode. */
  hasAnyUser(): Promise<boolean>;
}
