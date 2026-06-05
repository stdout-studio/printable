import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Headless unit tests for the pure logic (context-builder, tool wire-shapes,
// store coordination). Aliases mirror the app's `@/` + the workspace types
// package so esbuild transforms the TS directly (no build step needed).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@printable/types': fileURLToPath(
        new URL('../../packages/shared-types/src/index.ts', import.meta.url),
      ),
    },
  },
});
