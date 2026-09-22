import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const benchmarkUrl =
  process.env.NAVIGATION_BENCHMARK_URL ?? 'http://localhost:3333';
const skipBackend = process.env.NAVIGATION_BENCHMARK_SKIP_BACKEND === 'true';

const appServer = {
  command: 'yarn start-app',
  cwd: path.resolve(__dirname, '../..'),
  url: benchmarkUrl,
  reuseExistingServer: true,
  timeout: 120_000,
};

const backendServer = {
  command: 'yarn workspace backend start',
  cwd: path.resolve(__dirname, '../..'),
  url: 'http://localhost:7008/readiness',
  reuseExistingServer: true,
  timeout: 120_000,
};

export default defineConfig({
  testDir: './benchmarks',
  testMatch: '**/*.bench.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: benchmarkUrl,
    serviceWorkers: 'block',
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: skipBackend ? [appServer] : [backendServer, appServer],
});
