/**
 * Studio-mode auth: Better-Auth pointed at the shared stdout.studio Postgres,
 * with email+password AND Google SSO enabled.
 *
 * This is a stub until we provision the stdout.studio platform infra.
 * The interface matches localAuth so the app surface doesn't care which
 * is active.
 */

import type { AuthProvider } from './types';

export const studioAuth: AuthProvider = {
  async getSession(_headers: Headers) {
    throw new Error(
      'Studio mode not yet implemented. Set STDOUT_MODE=local or unset it.',
    );
  },

  async hasAnyUser() {
    // In studio mode, "hasAnyUser" is meaningless — multi-tenant signups
    // are always open. The setup wizard doesn't run.
    return true;
  },
};
