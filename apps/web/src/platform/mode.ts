/**
 * Run mode: local (self-hosted) or hosted.
 *
 * Default is `local` — that's the safe assumption when someone clones the
 * repo and runs it themselves. To activate Hosted mode (shared auth, Stripe,
 * etc.), set KERF_MODE=hosted in the environment.
 */

export type Mode = 'local' | 'hosted';

const RAW_MODE = process.env.KERF_MODE?.trim().toLowerCase();

export const MODE: Mode = RAW_MODE === 'hosted' ? 'hosted' : 'local';

export const IS_LOCAL = MODE === 'local';
export const IS_HOSTED = MODE === 'hosted';
