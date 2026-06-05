'use client';

/**
 * Minimal IndexedDB key-value store shaped as a zustand `StateStorage`, so the
 * projects store can persist across reloads. IndexedDB (not localStorage)
 * because project snapshots carry base64 STL bytes that blow localStorage's
 * ~5MB quota.
 *
 * SSR-safe + fail-safe: any failure (no IndexedDB, private mode, quota, blocked)
 * degrades to "no persisted state", so the app simply falls back to a fresh
 * session rather than breaking.
 */

const DB_NAME = 'kerf';
const STORE = 'kv';
const VERSION = 1;

function hasIDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export const idbStorage = {
  async getItem(name: string): Promise<string | null> {
    if (!hasIDB()) return null;
    try {
      const v = await run<unknown>('readonly', (s) => s.get(name));
      return (v as string | undefined) ?? null;
    } catch {
      return null;
    }
  },
  async setItem(name: string, value: string): Promise<void> {
    if (!hasIDB()) return;
    try {
      await run('readwrite', (s) => s.put(value, name));
    } catch {
      // best-effort: quota / blocked — drop silently
    }
  },
  async removeItem(name: string): Promise<void> {
    if (!hasIDB()) return;
    try {
      await run('readwrite', (s) => s.delete(name));
    } catch {
      // best-effort
    }
  },
};
