/**
 * Local-mode auth: SQLite-backed Better-Auth with email + password.
 *
 * Database file lives at $DATA_DIR/auth.db (defaults to ./data/auth.db).
 * Whatever process owns the Node runtime needs write access to that dir.
 *
 * The setup wizard creates the first user (the admin). After that, signup
 * is gated by config (default: closed — you self-host, you decide who can
 * log in). To open public signups on a self-hosted instance, set
 * STDOUT_ALLOW_SIGNUPS=true.
 */

import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { betterAuth } from 'better-auth';
import type { AuthProvider, Session, User } from './types';

const DATA_DIR = process.env.STDOUT_DATA_DIR ?? path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'auth.db');

// Ensure data dir exists before sqlite tries to open the file.
fs.mkdirSync(DATA_DIR, { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');

// Create Better-Auth's core schema if it doesn't exist yet. Idempotent —
// safe to run on every boot. Schema matches Better-Auth's default Kysely
// migrations as of v1.6; if BA's schema evolves we'll graduate to the
// official migration runner.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT NOT NULL UNIQUE,
    emailVerified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS session (
    id TEXT PRIMARY KEY,
    expiresAt INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS account (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    accessToken TEXT,
    refreshToken TEXT,
    idToken TEXT,
    accessTokenExpiresAt INTEGER,
    refreshTokenExpiresAt INTEGER,
    scope TEXT,
    password TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verification (
    id TEXT PRIMARY KEY,
    identifier TEXT NOT NULL,
    value TEXT NOT NULL,
    expiresAt INTEGER NOT NULL,
    createdAt INTEGER,
    updatedAt INTEGER
  );

  CREATE INDEX IF NOT EXISTS session_user_idx ON session(userId);
  CREATE INDEX IF NOT EXISTS session_token_idx ON session(token);
  CREATE INDEX IF NOT EXISTS account_user_idx ON account(userId);
  CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);
`);

export const ALLOW_PUBLIC_SIGNUPS =
  (process.env.STDOUT_ALLOW_SIGNUPS ?? '').trim().toLowerCase() === 'true';

// Better-Auth itself keeps email/password signup enabled — we need it
// available for the setup wizard. Whether /signup is publicly reachable
// is enforced at the route level (see app/signup/page.tsx), not here.
export const localBetterAuth = betterAuth({
  database: sqlite,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
  },
});

/**
 * Map Better-Auth's user/session shapes onto our AuthProvider interface.
 */
function toUser(raw: { id: string; email: string; name?: string | null; createdAt: Date | string }): User {
  return {
    id: raw.id,
    email: raw.email,
    name: raw.name ?? null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : raw.createdAt.toISOString(),
  };
}

export const localAuth: AuthProvider = {
  async getSession(headers: Headers): Promise<Session | null> {
    const session = await localBetterAuth.api.getSession({ headers });
    if (!session) return null;
    const expiresAt =
      typeof session.session.expiresAt === 'string'
        ? session.session.expiresAt
        : session.session.expiresAt.toISOString();
    return {
      user: toUser(session.user),
      expiresAt,
    };
  },

  async hasAnyUser(): Promise<boolean> {
    const row = sqlite
      .prepare<[], { count: number }>('SELECT COUNT(*) as count FROM user')
      .get();
    return (row?.count ?? 0) > 0;
  },
};
