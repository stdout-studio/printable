import { describe, it, expect, vi, beforeEach } from 'vitest';
import { studioBilling } from './billing';

beforeEach(() => {
  vi.restoreAllMocks();
});

function stubFetch(impl: (url: string, init?: unknown) => unknown) {
  const m = vi.fn(async (url: unknown, init?: unknown) => impl(String(url), init));
  vi.stubGlobal('fetch', m);
  return m;
}

describe('studioBilling', () => {
  it('queries entitlement by user + app slug and returns active', async () => {
    const m = stubFetch(() => ({ ok: true, json: async () => ({ active: true }) }));
    expect(await studioBilling.hasActiveSubscription('u1')).toBe(true);
    const url = String(m.mock.calls[0]![0]);
    expect(url).toContain('userId=u1');
    expect(url).toContain('app=kerf');
  });

  it('returns false when not entitled', async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ active: false }) }));
    expect(await studioBilling.hasActiveSubscription('u1')).toBe(false);
  });

  it('fails closed when the billing service is unreachable', async () => {
    stubFetch(() => {
      throw new Error('down');
    });
    expect(await studioBilling.hasActiveSubscription('u1')).toBe(false);
  });

  it('returns the customer-portal url', async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ url: 'https://portal.example' }) }));
    expect(await studioBilling.customerPortalUrl('u1')).toBe('https://portal.example');
  });
});
