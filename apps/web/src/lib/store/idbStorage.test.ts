import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { idbStorage } from './idbStorage';

describe('idbStorage', () => {
  it('round-trips a value', async () => {
    await idbStorage.setItem('k1', 'hello');
    expect(await idbStorage.getItem('k1')).toBe('hello');
  });

  it('returns null for missing keys', async () => {
    expect(await idbStorage.getItem('does-not-exist')).toBeNull();
  });

  it('removes a value', async () => {
    await idbStorage.setItem('k2', 'x');
    await idbStorage.removeItem('k2');
    expect(await idbStorage.getItem('k2')).toBeNull();
  });

  it('handles a large (multi-MB) value — the reason we use IDB over localStorage', async () => {
    const big = 'a'.repeat(2_000_000);
    await idbStorage.setItem('big', big);
    expect((await idbStorage.getItem('big'))?.length).toBe(2_000_000);
  });
});
