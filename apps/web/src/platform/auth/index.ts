/**
 * Auth provider factory. Picks the right implementation based on MODE.
 *
 * Local mode: SQLite-backed Better-Auth with email+password only.
 * Studio mode: shared-Postgres Better-Auth with email+password + Google SSO.
 *
 * Either way, the app surface (login/signup pages, /app middleware gate)
 * talks to the AuthProvider interface only.
 */

import { IS_STUDIO } from '../mode';
import type { AuthProvider } from './types';
import { localAuth } from './local';
import { studioAuth } from './studio';

export const auth: AuthProvider = IS_STUDIO ? studioAuth : localAuth;

export type { User, Session, AuthProvider } from './types';
