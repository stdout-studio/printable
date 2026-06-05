/**
 * Signup policy. Whether the /signup route should be reachable depends on
 * mode + env. Always callable from server components (it reads env vars
 * synchronously and doesn't depend on a request).
 */

import { IS_HOSTED } from '../mode';
import { ALLOW_PUBLIC_SIGNUPS } from './local';

/**
 * Whether public signups are allowed.
 *
 * - Hosted mode: always open (multi-tenant signups are the whole point).
 * - Local mode: only open if KERF_ALLOW_SIGNUPS=true. Default: closed.
 *   (The setup wizard creates the first user regardless of this flag.)
 */
export function publicSignupsAllowed(): boolean {
  if (IS_HOSTED) return true;
  return ALLOW_PUBLIC_SIGNUPS;
}
