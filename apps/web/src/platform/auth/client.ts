'use client';

/**
 * Browser-side auth client. Wraps Better-Auth's React client so the auth
 * UI doesn't import the server-only mode-detection logic.
 *
 * In hosted mode this would point at a different origin; for now both modes
 * hit /api/auth on the same origin.
 */

import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();
