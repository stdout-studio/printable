import { describe, it, expect, vi, beforeEach } from 'vitest';
import { studioAuth } from './studio';

beforeEach(() => {
  vi.restoreAllMocks();
});

function stubFetch(impl: (url: string, init?: unknown) => unknown) {
  const m = vi.fn(async (url: unknown, init?: unknown) => impl(String(url), init));
  vi.stubGlobal('fetch', m);
  return m;
}

function headersWith(cookie?: string): Headers {
  const h = new Headers();
  if (cookie) h.set('cookie', cookie);
  return h;
}

describe('studioAuth.getSession', () => {
  it('returns null without a cookie (no platform call)', async () => {
    const m = stubFetch(() => ({ ok: true, json: async () => ({}) }));
    expect(await studioAuth.getSession(headersWith())).toBeNull();
    expect(m).not.toHaveBeenCalled();
  });

  it('forwards the cookie and maps the platform user', async () => {
    const m = stubFetch(() => ({
      ok: true,
      json: async () => ({
        user: { id: 'u1', email: 'a@b.com', name: 'A' },
        expiresAt: '2030-01-01T00:00:00Z',
      }),
    }));
    const s = await studioAuth.getSession(headersWith('kerf_session=abc'));
    expect(s?.user).toMatchObject({ id: 'u1', email: 'a@b.com', name: 'A' });
    expect(s?.expiresAt).toBe('2030-01-01T00:00:00Z');
    const init = m.mock.calls[0]![1] as { headers: { cookie: string } };
    expect(init.headers.cookie).toBe('kerf_session=abc');
  });

  it('returns null on non-ok responses', async () => {
    stubFetch(() => ({ ok: false, json: async () => ({}) }));
    expect(await studioAuth.getSession(headersWith('x=1'))).toBeNull();
  });

  it('returns null on a malformed user (missing email/expiry)', async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ user: { id: 'u1' } }) }));
    expect(await studioAuth.getSession(headersWith('x=1'))).toBeNull();
  });
});
