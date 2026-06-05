/**
 * Auth provider factory. Picks the right implementation based on MODE.
 *
 * Local mode: SQLite-backed Better-Auth with email+password only.
 * Hosted mode: shared-Postgres Better-Auth with email+password + Google SSO.
 *
 * Either way, the app surface (login/signup pages, /app middleware gate)
 * talks to the AuthProvider interface only.
 */

import { IS_HOSTED } from '../mode';
import type { AuthProvider } from './types';
import { localAuth } from './local';
import { hostedAuth } from './hosted';

export const auth: AuthProvider = IS_HOSTED ? hostedAuth : localAuth;

export type { User, Session, AuthProvider } from './types';
