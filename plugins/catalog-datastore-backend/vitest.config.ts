import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    // Postgres integration tests can be slow under parallel-project load.
    testTimeout: 30_000,
    // TODO(vitest-migration): both require a live Postgres (testcontainers
    // or local DB) — they're integration tests, not migration-blocked.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'src/plugin.performance.test.ts',
      'src/webhooks/integration.test.ts',
    ],
  },
});
