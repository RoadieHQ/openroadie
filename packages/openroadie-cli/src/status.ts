import type { OpenRoadieConfig } from './config';
import { httpFailureReason, OpenRoadieHttpClient } from './http-client';
import type { HttpResult } from './http-client';
import { findPreset } from './commands/integration-presets';
import { READINESS_PATH } from './commands/up';

/**
 * The real OSS backend GET routes the status aggregator fans out across.
 * Located in the openroadie monorepo:
 *  - integrations: plugins/integrations-backend (router mounted at /api/integrations)
 *  - data sources: plugins/catalog-workflow-backend (data-source-seeds list)
 *  - objects: plugins/catalog-datastore-backend (objects list, has `total`)
 *  - relationship rules: plugins/catalog-datastore-backend (relationship-rules list)
 *  - health: plugins/healthcheck-backend (GET /healthcheck)
 *  - readiness: the deploy artifacts' readiness probe (200 once the APIs are
 *    actually serving, not merely alive) — the same signal `up` waits on.
 */
export const ENDPOINTS = {
  health: '/healthcheck',
  readiness: READINESS_PATH,
  integrations: '/api/integrations',
  /**
   * GET /api/integrations/github-app/install-link?appId&host&redirectUrl — the
   * GitHub-App install URL the user opens; /callback completes the loop. The
   * router is mounted under both /github-app and /github-enterprise-app (M2).
   */
  githubAppInstallLink: '/api/integrations/github-app/install-link',
  /** GET /api/integrations/github-app/installations?appId&host — install rows (M2). */
  githubAppInstallations: '/api/integrations/github-app/installations',
  /** GET /api/integrations/github-app/apps?integrationId — linked GitHub Apps (M2). */
  githubApps: '/api/integrations/github-app/apps',
  dataSourceSeeds: '/api/catalog-workflow/data-source-seeds',
  /** POST { seeds: string[] } — apply (enable) the named seeds (M1). */
  dataSourceSeedsApply: '/api/catalog-workflow/data-source-seeds/apply',
  /** GET /api/catalog-workflow/workflows?workflowType=data-ingestion — list (M2). */
  workflows: '/api/catalog-workflow/workflows',
  /** GET /api/catalog-workflow/executions/:id — one execution's status (M2). */
  executions: '/api/catalog-workflow/executions',
  objects: '/api/catalog-datastore/objects',
  relationshipRules: '/api/catalog-datastore/relationship-rules',
  relationships: '/api/catalog-datastore/relationships',
  /** POST { datasourceIds: string[] } — suggest relationships across sources (M1). */
  suggestRelationships: '/api/catalog-datastore/schemas/suggest-relationships',
  /** GET/POST { name, description, instructions } — reusable agent capabilities. */
  capabilities: '/api/capabilities',
  /** GET/POST — actions (parameterized integration requests). */
  actions: '/api/actions',
  /** GET/POST rules — context-group rules (clusters of related objects). */
  contextGroupRules: '/api/catalog-datastore/context-groups/rules',
  /** POST /api/secrets-settings/keys { name, value } — write-only secret (M1). */
  secretKeys: '/api/secrets-settings/keys',
  /** POST /api/mcp/v1/explore — read-only catalog MCP (streamable HTTP) (M1). */
  mcpExplore: '/api/mcp/v1/explore',
} as const;

interface IntegrationRow {
  id: string;
  name?: string;
  slug?: string;
  /** True once the integration's auth secrets resolve for the current scope. */
  readyForCurrentScope?: boolean;
}

interface IntegrationsResponse {
  data?: IntegrationRow[];
}

interface SeedRow {
  name: string;
  integrationSlug?: string;
  /** True when the backing integration is configured / ready. */
  integrationConfigured?: boolean;
  /** True once the seed workflow exists in the DB (i.e. it has been enabled). */
  created?: boolean;
}

interface SeedsResponse {
  data?: SeedRow[];
}

interface ObjectsResponse {
  items?: unknown[];
  total?: number;
}

interface RuleRow {
  id: string;
  state?: 'suggested' | 'active' | 'inactive';
}

interface RulesResponse {
  items?: RuleRow[];
  total?: number;
}

export interface StatusPayload {
  server: { up: true; url: string } | null;
  integrations: Array<{ id: string; name: string; connected: boolean }>;
  sources: { enabled: string[]; available: string[] };
  indexed: { done: boolean; objects: number };
  rules: { suggested: number; approved: number };
  failedRoutes: Array<{ route: string; status: number; reason: string }>;
  nextStep: string;
  complete: boolean;
}

function failedRoute(
  route: string,
  res: HttpResult<unknown>,
): { route: string; status: number; reason: string } | undefined {
  return res.ok
    ? undefined
    : { route, status: res.status, reason: httpFailureReason(res) };
}

/**
 * Read every live endpoint and compute readiness + the next command to run.
 *
 * The `nextStep` ladder walks the install from a bare server to a complete
 * catalog, emitting the single next command at each rung:
 *   up
 *   → ask which tools they use, then: integrations enable <ids>
 *   → setup (the wizard drives connect; ids here are presets, not raw UUIDs)
 *   → sources enable --all
 *   → index
 *   → relationships suggest
 *   → review
 *   → complete
 */
export async function computeStatus(
  config: OpenRoadieConfig,
  fetchImpl?: typeof globalThis.fetch,
): Promise<StatusPayload> {
  const client = new OpenRoadieHttpClient(config, fetchImpl);

  // Reachability mirrors `up`: `/readiness` returns 200 only once the APIs are
  // actually serving, whereas `/healthcheck` answers 200 while the process is
  // still initializing — probing it would advance `nextStep` before the routes
  // the ladder depends on can respond.
  const readiness = await client.get<{ status?: string }>(ENDPOINTS.readiness);
  const serverUp = readiness.ok;

  if (!serverUp) {
    return {
      server: null,
      integrations: [],
      sources: { enabled: [], available: [] },
      indexed: { done: false, objects: 0 },
      rules: { suggested: 0, approved: 0 },
      failedRoutes: [],
      nextStep: 'up',
      complete: false,
    };
  }

  const [integrationsRes, seedsRes, objectsRes, rulesRes] = await Promise.all([
    client.get<IntegrationsResponse>(ENDPOINTS.integrations),
    client.get<SeedsResponse>(ENDPOINTS.dataSourceSeeds),
    client.get<ObjectsResponse>(ENDPOINTS.objects),
    client.get<RulesResponse>(`${ENDPOINTS.relationshipRules}?state=suggested`),
  ]);
  const allRulesResPromise = client.get<RulesResponse>(
    ENDPOINTS.relationshipRules,
  );

  const dependencyFailures = [
    failedRoute('integrations', integrationsRes),
    failedRoute('data-source-seeds', seedsRes),
    failedRoute('objects', objectsRes),
    failedRoute('relationship-rules?suggested', rulesRes),
  ].filter(
    (failure): failure is { route: string; status: number; reason: string } =>
      failure !== undefined,
  );

  // Integrations: a row in the list is "enabled"; connected = ready for scope.
  // Emit the CLI preset id (not the backend UUID) as `id` so the value is
  // directly usable by `connect`/`integrations enable` — they resolve presets,
  // not UUIDs. A row's slug maps through `findPreset` (which honors slug
  // aliases, so `github-token` → `github` while `github-app` remains its own
  // explicit App-flow option); user-created rows with no preset fall back to
  // their slug, then their UUID.
  const integrationRows = integrationsRes.body?.data ?? [];
  const integrations = integrationRows.map(row => ({
    id: findPreset(row.slug ?? row.id)?.id ?? row.slug ?? row.id,
    name: row.name ?? row.slug ?? row.id,
    connected: row.readyForCurrentScope === true,
  }));

  // Sources: only seeds whose integration is configured are actually available;
  // a seed is "enabled" once its workflow has been created.
  const seedRows = (seedsRes.body?.data ?? []).filter(
    seed => seed.integrationConfigured === true,
  );
  const availableSources = seedRows.map(seed => seed.name);
  const enabledSources = seedRows
    .filter(seed => seed.created === true)
    .map(seed => seed.name);

  const objectCount =
    typeof objectsRes.body?.total === 'number'
      ? objectsRes.body.total
      : (objectsRes.body?.items ?? []).length;
  const indexedDone = objectCount > 0;

  // Rules: any row at all means "suggested" ran; active rows are approved.
  // The `?state=suggested` query returns the still-pending suggestions.
  const suggestedRules = rulesRes.body?.items ?? [];
  const suggestedCount =
    typeof rulesRes.body?.total === 'number'
      ? rulesRes.body.total
      : suggestedRules.length;
  const allRulesRes = await allRulesResPromise;
  const allRulesFailure = failedRoute('relationship-rules', allRulesRes);
  if (allRulesFailure) {
    dependencyFailures.push(allRulesFailure);
  }
  const approvedCount = (allRulesRes.body?.items ?? []).filter(
    rule => rule.state === 'active',
  ).length;
  const anyRulesExist =
    suggestedCount > 0 || (allRulesRes.body?.items ?? []).length > 0;

  let nextStep: string;
  if (dependencyFailures.length > 0) {
    const failure = dependencyFailures[0];
    nextStep = `fix unreadable status dependency: ${failure.route}`;
  } else if (integrations.length === 0) {
    nextStep =
      'ask the user which services they use, then: integrations enable <ids>';
  } else if (integrations.every(integration => !integration.connected)) {
    // Nothing connected yet → run the setup wizard. (Only when ZERO are
    // connected: a user connects the few integrations they use, never all of
    // them, so requiring every integration connected would dead-end the ladder
    // on "connect" forever — past that, progress is sources/index/rules.) We
    // emit `setup`, not `connect <id>`: the integration ids here are the
    // backend's UUIDs, but `connect` only accepts preset slugs, so a literal
    // `connect <uuid>` fails. The wizard is the real connect path anyway.
    nextStep = 'setup';
  } else if (availableSources.length > 0 && enabledSources.length === 0) {
    nextStep = 'sources enable --all';
  } else if (!indexedDone) {
    nextStep = 'index';
  } else if (!anyRulesExist) {
    nextStep = 'relationships suggest';
  } else if (approvedCount === 0 || suggestedCount > 0) {
    nextStep = 'review';
  } else {
    nextStep = 'complete';
  }

  return {
    server: { up: true, url: config.backendUrl },
    integrations,
    sources: { enabled: enabledSources, available: availableSources },
    indexed: { done: indexedDone, objects: objectCount },
    rules: { suggested: suggestedCount, approved: approvedCount },
    failedRoutes: dependencyFailures,
    nextStep,
    complete: dependencyFailures.length === 0 && nextStep === 'complete',
  };
}
