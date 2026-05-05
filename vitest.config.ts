import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/server/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    pool: 'forks',
    setupFiles: ['./src/server/test-setup.ts'],
    // Tests must not touch real network or shared filesystem state.
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@shared': new URL('./src/shared', import.meta.url).pathname,
    },
  },
});
