import { createRoadieBackend } from '@roadiehq/backend-defaults';
import { aiServiceFactory } from '@roadiehq/ai-backend';
import { secretsMetadataServiceFactory } from '@roadiehq/secrets-settings-backend';
import { mcpSettingsServiceFactory } from '@roadiehq/mcp-settings-backend';
import express from 'express';
import {
  createScopeService,
  scopeServiceRef,
  ALL_SCOPES,
} from '@roadiehq/scopes';
import {
  createServiceFactory,
  internalFetchServiceFactory,
  internalRequestContextMiddleware,
} from '@roadiehq/extensions-api';
import { registerStandaloneMigrationPaths } from './registerStandalonePaths';
import { entityChangeStreamPlugin } from './entity-change-stream';

// Standalone distribution: point plugin migration lookups at the shipped files.
// No-op unless OPENROADIE_MIGRATIONS_DIR is set. Must run before backend.start().
registerStandaloneMigrationPaths();

const backend = createRoadieBackend(({ app }) => {
  // Capture each inbound request into async-local context so
  // `internalFetchServiceRef` (below) can forward the caller's credentials
  // on internal backend-to-backend calls. Must run ahead of plugin routers.
  app.use(internalRequestContextMiddleware());
  app.use('/api/catalog/*', express.json({ limit: '50mb' }));
  app.use('/api/catalog/roadie-entities/*', express.json({ limit: '50mb' }));
  app.use('/api/catalog/roadie-agent/*', express.json({ limit: '50mb' }));
  app.use('/api/catalog/fragments', express.json({ limit: '50mb' }));
});

// Scope enforcement for the REST API and MCP server. The default service
// grants every scope (enforcement is a no-op). Wire a real token->scopes
// retriever to gate agent tokens by registering a factory for
// `scopeServiceRef`. Pass the retriever through `createScopeService` and the
// REST guard + MCP enforcement are derived for free; return `ALL_SCOPES` to
// grant everything:
backend.add(
  createServiceFactory({
    service: scopeServiceRef,
    deps: {},
    async factory() {
      return createScopeService(async req => {
        const header = [req.headers['authorization']].flat()[0];
        if (header) {
          // Expect `<scheme> <token>`, where <token> is a comma-separated
          // scope list. A malformed header (no scheme/token segment, e.g. a
          // bare `Bearer` or an empty minted token) must not crash the guard —
          // fall back to granting everything, matching the no-header default.
          const token = header.split(' ')[1];
          if (token) {
            return token
              .split(',')
              .map(scope => scope.trim())
              .filter(Boolean);
          }
        }
        return ALL_SCOPES;
      });
    },
  }),
);

// Authenticated fetch for internal backend-to-backend calls. Inside an
// inbound request it forwards the caller's `authorization` / `x-scope-id`
// headers; background work (schedulers, workflow executions) falls back to a
// minted service token — blank in OSS, where internal calls are ungated.
// Hops that must never ride the caller (workflow runs, seed applies) take
// `internalFetch.asService()` instead. Deployments that authenticate internal
// traffic differently register their own factory for `internalFetchServiceRef`
// here, like `scopeServiceRef` above.
backend.add(internalFetchServiceFactory);

backend.add(aiServiceFactory);
backend.add(secretsMetadataServiceFactory);

backend.add(import('@roadiehq/integrations-backend'));

backend.add(import('@roadiehq/catalog-datastore-backend'));

backend.add(mcpSettingsServiceFactory);
backend.add(import('@roadiehq/mcp-settings-backend'));
backend.add(import('@roadiehq/roadie-mcp-server'));
backend.add(import('@roadiehq/mcp-catalog-datastore-module'));

backend.add(import('@roadiehq/ai-backend'));

backend.add(import('@roadiehq/catalog-workflow-backend'));

backend.add(import('@roadiehq/secrets-settings-backend'));

backend.add(import('@roadiehq/capabilities-backend'));

backend.add(import('@roadiehq/workspaces-backend'));

backend.add(import('@roadiehq/actions-backend'));
backend.add(import('@roadiehq/mcp-actions-module'));
backend.add(entityChangeStreamPlugin);

backend.start();
