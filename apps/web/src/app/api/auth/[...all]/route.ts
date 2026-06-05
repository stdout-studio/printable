/**
 * Better-Auth handler — covers /api/auth/signin, /signup, /signout,
 * /session, all OAuth callbacks, etc. The library packages everything
 * behind a single handler that takes Web Request.
 */

import { IS_LOCAL } from '@/platform/mode';
import { localBetterAuth } from '@/platform/auth/local';

export const runtime = 'nodejs';

async function handler(req: Request) {
  if (!IS_LOCAL) {
    return new Response(
      JSON.stringify({ error: 'Hosted mode auth not yet implemented.' }),
      { status: 501, headers: { 'content-type': 'application/json' } },
    );
  }
  return localBetterAuth.handler(req);
}

export { handler as GET, handler as POST };
