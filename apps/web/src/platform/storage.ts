/**
 * Storage provider. Local mode: filesystem under $STDOUT_DATA_DIR/files.
 * Studio mode: shared S3-compatible bucket (stubbed).
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { IS_STUDIO } from './mode';

export interface StorageProvider {
  /** Put bytes under a key. Returns a URL the app can serve to clients. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
  /** Read bytes back, or null if missing. */
  get(key: string): Promise<Uint8Array | null>;
  /** Delete an object. No-op if it doesn't exist. */
  delete(key: string): Promise<void>;
}

const DATA_DIR = process.env.STDOUT_DATA_DIR ?? path.resolve(process.cwd(), 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');

const localStorage: StorageProvider = {
  async put(key, bytes, _contentType) {
    const target = path.join(FILES_DIR, key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    return `/api/files/${encodeURIComponent(key)}`;
  },
  async get(key) {
    const target = path.join(FILES_DIR, key);
    try {
      const buf = await fs.readFile(target);
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  },
  async delete(key) {
    const target = path.join(FILES_DIR, key);
    try {
      await fs.unlink(target);
    } catch {
      // not there, nothing to do
    }
  },
};

const studioStorage: StorageProvider = {
  async put(_key, _bytes, _contentType) {
    throw new Error('Studio storage not yet implemented.');
  },
  async get() {
    throw new Error('Studio storage not yet implemented.');
  },
  async delete() {
    throw new Error('Studio storage not yet implemented.');
  },
};

export const storage: StorageProvider = IS_STUDIO ? studioStorage : localStorage;
