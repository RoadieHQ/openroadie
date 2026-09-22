import { defineConfig } from 'vitest/config';

const isCI = !!process.env.CI;

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    reporters: isCI ? ['default', 'github-actions'] : ['default'],
    coverage: {
      provider: 'v8',
      reporter: isCI ? ['text', 'json-summary', 'json'] : ['text'],
      reportsDirectory: './coverage',
    },
  },
});
