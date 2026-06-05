/**
 * Printable's concrete AppConfig. This is the one place the platform
 * abstractions get pointed at this specific app's identity + copy.
 *
 * Other stdout.studio apps will have their own app-config.ts with the
 * same shape but their own values.
 */

import type { AppConfig } from './config';

export const appConfig: AppConfig = {
  slug: 'kerf',
  name: 'Kerf',
  tagline: 'Design 3D-printable parts by pointing, sketching, and chatting.',
  description:
    'Point at it, draw on it, describe it — Kerf turns your intent into a clean, ready-to-print STL. Fit a part to something you own, remix an existing model, or start from scratch: phone mounts, brackets, replacement clips, custom adapters, and whatever else you can describe.',
  githubUrl: 'https://github.com/stdout-studio/printable',
  selfHostCommand: 'git clone https://github.com/stdout-studio/printable && cd printable && docker compose up',
  guestModeEnabled: false,

  requiredEnvVars: [
    {
      key: 'ANTHROPIC_API_KEY',
      label: 'Anthropic API key',
      description:
        'Used to drive the AI agent that proposes and edits 3D geometry. Get one at console.anthropic.com.',
      required: true,
      helpUrl: 'https://console.anthropic.com/settings/keys',
      validate: '^sk-ant-',
    },
    {
      key: 'BLENDER_WORKER_URL',
      label: 'Blender worker URL',
      description:
        'URL where the Blender worker (separate Python service) is reachable. Default: http://localhost:8080. In docker compose this is auto-wired.',
      required: false,
    },
  ],

  legal: {
    operator: 'self-hosted instance',
    address: 'See operator',
    contactEmail: 'operator@example.com',
  },
};
