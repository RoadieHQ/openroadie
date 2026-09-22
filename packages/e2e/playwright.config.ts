import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/global-setup.ts', '**/fixtures.ts'],
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  use: {
    // Override for a worktree running on non-default ports (pairs with
    // BACKEND_URL in tests/backend.ts).
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3333',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /scopes\//,
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: /scopes\//,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: /scopes\//,
    },
    // Scope-enforcement specs are pure HTTP + MCP JSON-RPC — no DOM. Run them
    // once in a single no-browser project (not ×3 across the browsers above),
    // which also avoids concurrent clients racing on the shared fixtures.
    {
      name: 'scopes-api',
      testMatch: /scopes\/scopes\.spec\.ts/,
      fullyParallel: false,
      use: {},
    },
    // Catalog/registry parity is also pure HTTP + MCP JSON-RPC (no DOM). It
    // toggles MCP server enablement, so it runs in its own no-browser project.
    {
      name: 'mcp-catalog-parity',
      testMatch: /scopes\/mcp-catalog-parity\.spec\.ts/,
      fullyParallel: false,
      use: {},
    },
  ],
  // Only start servers in CI or when explicitly requested
  // For local dev, run `yarn dev` separately before running tests
  webServer: isCI
    ? [
        {
          // Use CI config overlay with PostgreSQL service container settings
          command:
            'yarn workspace backend start --config ../../app-config.yaml --config ../../app-config.development.yaml 2>&1 | tee backend.log',
          cwd: path.resolve(__dirname, '../..'),
          url: 'http://localhost:7008/readiness',
          reuseExistingServer: false,
          timeout: 120000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command: 'yarn start-app 2>&1 | tee frontend.log',
          cwd: path.resolve(__dirname, '../..'),
          url: 'http://localhost:3333',
          reuseExistingServer: false,
          timeout: 120000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      ]
    : undefined,
});
