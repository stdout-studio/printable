import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Headless unit tests for the pure logic (context-builder, tool wire-shapes,
// store coordination). Aliases mirror the app's `@/` + the workspace types
// package so esbuild transforms the TS directly (no build step needed).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Hosted-mode providers read these at call time; give the tests a base URL
    // (the fetch is mocked, so the value just needs to be non-empty).
    env: {
      HOSTED_AUTH_URL: 'https://auth.test',
      HOSTED_BILLING_URL: 'https://billing.test',
    },
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
