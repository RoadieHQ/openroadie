import { defineConfig } from 'vitest/config';

const isCI = !!process.env.CI;

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    reporters: isCI ? ['default', 'github-actions'] : ['default'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: isCI ? ['text', 'json-summary', 'json'] : ['text'],
      reportsDirectory: './coverage',
    },
  },
});
