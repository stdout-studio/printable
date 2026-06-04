/**
 * Platform mode: local (self-hosted) or studio (hosted on stdout.studio).
 *
 * Default is `local` — that's the safe assumption when someone clones the
 * repo and runs it themselves. To activate Studio mode (shared auth, Stripe,
 * etc.), set STDOUT_MODE=studio in the environment.
 */

export type Mode = 'local' | 'studio';

const RAW_MODE = process.env.STDOUT_MODE?.trim().toLowerCase();

export const MODE: Mode = RAW_MODE === 'studio' ? 'studio' : 'local';

export const IS_LOCAL = MODE === 'local';
export const IS_STUDIO = MODE === 'studio';
