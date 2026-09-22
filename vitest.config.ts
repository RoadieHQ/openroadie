import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      // Not 'packages/app': its vitest.config.ts defines nested projects
      // (unit + storybook browser tests), which Vitest silently ignores when
      // loaded as a project. Reference the flat unit config directly.
      'packages/app/vitest.unit.config.ts',
      'packages/ui',
      'packages/backend',
      'packages/backend-defaults',
      'packages/errors',
      'packages/extensions-api',
      'packages/mock-integrations',
      'packages/openroadie-cli',
      'plugins/*',
    ],
    coverage: {
      // json-summary + json are required by davelosert/vitest-coverage-report-action
      // in .github/workflows/validate.yaml. text/html are kept for local DX.
      reporter: ['text', 'html', 'json', 'json-summary'],
    },
  },
});
