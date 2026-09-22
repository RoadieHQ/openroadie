import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Self-contained unit-test project. Referenced both by the monorepo root
// vitest.config.ts and by this package's vitest.config.ts — it must not
// define `projects` itself (nested projects are silently ignored by Vitest).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '~app-config': resolve(
        __dirname,
        'src/api/infrastructure/stubs/app-config.bundle.ts',
      ),
      '~admin-section-extensions': resolve(
        __dirname,
        'src/config/admin-section-extensions-noop.ts',
      ),
      'virtual:pwa-register/react': resolve(
        __dirname,
        'src/api/infrastructure/stubs/pwa-register.ts',
      ),
    },
  },
  test: {
    name: 'app',
    globals: true,
    environment: 'jsdom',
    pool: 'threads',
    testTimeout: 15000,
    setupFiles: ['./src/test-setup.ts'],
    // The SaaS meta-workspace hoists react-query to its root while react-dom
    // stays here, which gives the test run two React instances and null hooks.
    // Inlining react-query puts it back on this package's React.
    server: { deps: { inline: [/@tanstack\/react-query/] } },
  },
});
