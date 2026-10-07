import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import {
  appConfigPlugin,
  resolveAppConfigRoot,
} from './vite-app-config-plugin';

const dirname =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

const isCI = !!process.env.CI;

// In-package config: unit tests + Storybook story tests.
// The monorepo root vitest.config.ts references vitest.unit.config.ts
// directly (not this file) — story tests run via `--project=storybook`
// here or through the Storybook test addon / MCP `run-story-tests`.
export default defineConfig({
  test: {
    reporters: isCI ? ['default', 'github-actions'] : ['default'],
    coverage: {
      provider: 'v8',
      reporter: isCI ? ['text', 'json-summary', 'json'] : ['text'],
      reportsDirectory: './coverage',
    },
    projects: [
      './vitest.unit.config.ts',
      {
        // `storybook dev` inherits the app's full vite.config.ts, but its
        // node-polyfills plugin breaks Storybook internals under Vitest —
        // so recreate only the resolution pieces stories actually need:
        // the app-config virtual module and the stub aliases unit tests use.
        plugins: [
          appConfigPlugin(resolveAppConfigRoot),
          // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
          storybookTest({
            configDir: path.join(dirname, '.storybook'),
          }),
        ],
        resolve: {
          alias: {
            '~auth': resolve(dirname, 'src/auth-noop.ts'),
            '~github-app-template-link': resolve(
              dirname,
              'src/components/integrations/form/github-app-template-link.ts',
            ),
            '~admin-section-extensions': resolve(
              dirname,
              'src/config/admin-section-extensions-noop.ts',
            ),
            'virtual:pwa-register/react': resolve(
              dirname,
              'src/api/infrastructure/stubs/pwa-register.ts',
            ),
          },
        },
        test: {
          name: 'storybook',
          setupFiles: [path.join(dirname, '.storybook/vitest.setup.ts')],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [
              {
                browser: 'chromium',
              },
            ],
          },
        },
      },
    ],
  },
});
