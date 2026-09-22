import type {
  ActionRow,
  CapabilityRow,
  ContextGroupRow,
  FilterRow,
  IntegrationRow,
  NodeRow,
  RuleRow,
  RelationshipRow,
  WorkflowRow,
} from './api';
import { createHash } from 'node:crypto';
import {
  API_VERSION,
  secretRefsIn,
  type BundleKind,
  type Manifest,
  slugify,
} from './format';

/**
 * DB shape → portable manifest rewriting. UUIDs never travel: integration and
 * datasource references become slugs, and volatile/derived fields (row ids,
 * timestamps, versions, scoring) are stripped. Specs are built by explicit
 * key picking — the strip list is the format contract, so never
 * spread-then-delete.
 */
export interface SlugMaps {
  integrationSlugById: Map<string, string>;
  datasourceSlugById: Map<string, string>;
  integrationIdBySlug: Map<string, string>;
  datasourceIdBySlug: Map<string, string>;
  /** Datasource name → slug, for resolving a context-group filter's `seedName`. */
  datasourceSlugByName: Map<string, string>;
}

export function buildSlugMaps(
  workflows: WorkflowRow[],
  integrations: IntegrationRow[],
): SlugMaps {
  const maps: SlugMaps = {
    integrationSlugById: new Map(),
    datasourceSlugById: new Map(),
    integrationIdBySlug: new Map(),
    datasourceIdBySlug: new Map(),
    datasourceSlugByName: new Map(),
  };
  for (const integration of integrations) {
    maps.integrationSlugById.set(integration.id, integration.slug);
    maps.integrationIdBySlug.set(integration.slug, integration.id);
  }
  for (const workflow of workflows) {
    maps.datasourceSlugById.set(workflow.id, workflow.slug);
    maps.datasourceIdBySlug.set(workflow.slug, workflow.id);
    maps.datasourceSlugByName.set(workflow.name, workflow.slug);
  }
  return maps;
}

/**
 * Resolve a context-group filter's `seedName` to a datasource slug the way the
 * backend does (`ContextGroupDao.resolveDatasourceStatuses`): by workflow name
 * first, then by slug. The two differ whenever a datasource was renamed —
 * `WorkflowDao.update` deliberately never re-slugs, so `slug` keeps its
 * pre-rename value and `slugify(name)` matches nothing.
 *
 * Falls back to `slugify(seedName)` so a seed naming a datasource this
 * environment does not have stays symbolic rather than failing the export.
 */
export function seedDatasourceSlug(maps: SlugMaps, seedName: string): string {
  return maps.datasourceSlugByName.get(seedName) ?? slugify(seedName);
}

function requireIntegrationSlug(
  maps: SlugMaps,
  integrationId: string,
  context: string,
): string {
  const slug = maps.integrationSlugById.get(integrationId);
  if (!slug) {
    throw new Error(
      `${context} references unknown integration ${integrationId}`,
    );
  }
  return slug;
}

function metadataOf(
  slug: string,
  name: string,
  description?: string | null,
): Manifest['metadata'] {
  return description ? { slug, name, description } : { slug, name };
}

function withDefined(
  entries: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entries).filter(
      ([, value]) => value !== undefined && value !== null,
    ),
  );
}

function portableNode(
  node: NodeRow,
  maps: SlugMaps,
  datasourceSlug: string,
): Record<string, unknown> {
  // `integrationSlug` is dropped from `rest` rather than relied on being
  // overwritten: `integrationId` is the authoritative binding, and an import
  // that could not resolve one leaves a symbolic `integrationSlug` behind in a
  // config blob nothing later prunes. Once the node is bound, that leftover is
  // stale, and spreading `rest` over the resolved slug exported it in place of
  // the real one. Deleting it keeps this correct however the literal is reordered.
  const {
    integrationId,
    integrationSlug: _staleSlug,
    ...rest
  } = node.data.config;
  const config =
    typeof integrationId === 'string'
      ? {
          integrationSlug: requireIntegrationSlug(
            maps,
            integrationId,
            `datasource ${datasourceSlug} node ${node.id}`,
          ),
          ...rest,
        }
      : // No id to resolve: keep the config as-is, so a symbolic
        // `integrationSlug` from an unresolved import still travels.
        node.data.config;
  return withDefined({
    id: node.id,
    type: node.type,
    position: node.position,
    data: { label: node.data.label, config },
    width: node.width,
    height: node.height,
  });
}

export function datasourceToManifest(
  workflow: WorkflowRow,
  maps: SlugMaps,
): Manifest {
  return {
    apiVersion: API_VERSION,
    kind: 'DataSource',
    metadata: metadataOf(workflow.slug, workflow.name, workflow.description),
    spec: withDefined({
      workflowType: workflow.workflowType,
      enabled: workflow.enabled,
      viewport: workflow.viewport,
      edges: workflow.edges,
      nodes: workflow.nodes.map(node =>
        portableNode(node, maps, workflow.slug),
      ),
    }),
  };
}

export function directRelationshipToManifest(
  relationship: RelationshipRow,
  maps: SlugMaps,
): Manifest {
  const sourceDatasourceSlug = maps.datasourceSlugById.get(
    relationship.sourceDatasourceId,
  );
  const destinationDatasourceSlug = maps.datasourceSlugById.get(
    relationship.destinationDatasourceId,
  );
  if (!sourceDatasourceSlug || !destinationDatasourceSlug) {
    throw new Error('relationship references an unknown datasource');
  }
  const tuple = [
    sourceDatasourceSlug,
    relationship.sourceObjectId,
    destinationDatasourceSlug,
    relationship.destinationObjectId,
    relationship.relationshipType,
  ];
  const slug = `direct-${createHash('sha256')
    .update(JSON.stringify(tuple))
    .digest('hex')
    .slice(0, 12)}`;
  return {
    apiVersion: API_VERSION,
    kind: 'DirectRelationship',
    metadata: metadataOf(
      slug,
      `${sourceDatasourceSlug}:${relationship.sourceObjectId} to ${destinationDatasourceSlug}:${relationship.destinationObjectId}`,
    ),
    spec: withDefined({
      sourceDatasourceSlug,
      sourceObjectId: relationship.sourceObjectId,
      destinationDatasourceSlug,
      destinationObjectId: relationship.destinationObjectId,
      relationshipType: relationship.relationshipType,
      reciprocalRelationshipType: relationship.reciprocalRelationshipType,
      origin: relationship.origin,
      metadata: relationship.metadata,
    }),
  };
}

function requireDatasourceSlug(maps: SlugMaps, datasourceId: string): string {
  const slug = maps.datasourceSlugById.get(datasourceId);
  if (!slug) {
    throw new Error(`rule references unknown datasource ${datasourceId}`);
  }
  return slug;
}

export function ruleToManifest(
  rule: RuleRow,
  maps: SlugMaps,
  filename: string,
): Manifest {
  let integrationConfig: Record<string, unknown> | undefined;
  if (rule.integrationConfig) {
    const { integrationId, ...rest } = rule.integrationConfig;
    integrationConfig =
      typeof integrationId === 'string'
        ? {
            integrationSlug: requireIntegrationSlug(
              maps,
              integrationId,
              `rule ${rule.name}`,
            ),
            ...rest,
          }
        : rule.integrationConfig;
  }
  return {
    apiVersion: API_VERSION,
    kind: 'RelationshipRule',
    metadata: metadataOf(filename, rule.name, rule.description),
    spec: withDefined({
      sourceDatasourceSlug: requireDatasourceSlug(
        maps,
        rule.sourceDatasourceId,
      ),
      targetDatasourceSlug: requireDatasourceSlug(
        maps,
        rule.targetDatasourceId,
      ),
      sourceFieldExpression: rule.sourceFieldExpression,
      targetFieldExpression: rule.targetFieldExpression,
      sourceFilterExpression: rule.sourceFilterExpression,
      targetFilterExpression: rule.targetFilterExpression,
      relationshipType: rule.relationshipType,
      reciprocalRelationshipType: rule.reciprocalRelationshipType,
      strategy: rule.strategy,
      matchStrategy: rule.matchStrategy,
      integrationConfig,
      state: rule.state,
    }),
  };
}

function portableFilter(
  filter: FilterRow,
  maps: SlugMaps,
): Record<string, unknown> {
  // A `datasourceId` that no longer resolves must still fall through to
  // `seedName`: committing to the id branch meant one stale reference — the
  // datasource was deleted, or deleted and recreated — took the whole context
  // group out of the export, even though its name still resolved.
  const datasourceSlug =
    (filter.datasourceId
      ? maps.datasourceSlugById.get(filter.datasourceId)
      : undefined) ??
    (filter.seedName ? seedDatasourceSlug(maps, filter.seedName) : undefined);
  if (!datasourceSlug) {
    throw new Error(
      `context-group filter references unknown datasource ${filter.datasourceId ?? '(none)'}`,
    );
  }
  return withDefined({
    datasourceSlug,
    filter: filter.filter,
    projection: filter.projection,
    annotation: filter.annotation,
  });
}

export function contextGroupToManifest(
  group: ContextGroupRow,
  maps: SlugMaps,
): Manifest {
  return {
    apiVersion: API_VERSION,
    kind: 'ContextGroup',
    metadata: metadataOf(group.slug, group.name, group.description),
    spec: {
      datasources: group.datasources.map(f => portableFilter(f, maps)),
      mergeRelationshipTypes: group.mergeRelationshipTypes,
      annotations: group.annotations,
      includeExternalRelations: group.includeExternalRelations,
    },
  };
}

export function capabilityToManifest(capability: CapabilityRow): Manifest {
  return {
    apiVersion: API_VERSION,
    kind: 'Capability',
    metadata: metadataOf(
      capability.slug,
      capability.name,
      capability.description,
    ),
    spec: { instructions: capability.instructions ?? '' },
  };
}

export function actionToManifest(action: ActionRow, maps: SlugMaps): Manifest {
  return {
    apiVersion: API_VERSION,
    kind: 'Action',
    metadata: metadataOf(action.slug, action.name, action.description),
    spec: withDefined({
      parameters: action.parameters,
      steps: action.steps.map(step => {
        const { integrationId, ...rest } = step;
        return {
          ...rest,
          integrationSlug: requireIntegrationSlug(
            maps,
            integrationId,
            `action ${action.slug} step ${step.id}`,
          ),
        };
      }),
      enabled: action.enabled,
    }),
  };
}

/**
 * Stub for a user-created integration: the shareable definition (host, auth
 * template with `${SECRET_REF}` placeholders) so an importer can recreate it
 * and be prompted for the secrets. Built-ins (`createdBy: 'system'`) exist on
 * every install and are never exported — they stay prerequisites-only.
 */
export function integrationToManifest(integration: IntegrationRow): Manifest {
  return {
    apiVersion: API_VERSION,
    kind: 'Integration',
    metadata: metadataOf(
      integration.slug,
      integration.name ?? integration.slug,
    ),
    spec: withDefined({
      type: integration.type,
      host: integration.host,
      authType: integration.authType,
      authConfig: integration.authConfig,
      backendType: integration.backendType,
      config: integration.config,
      graphqlPath: integration.graphqlPath,
      // All three rate-limit fields travel, not just the hourly one: the create
      // API accepts each independently and defaults the rest, so carrying one of
      // three silently re-rated the integration on the target.
      requestsPerHour: integration.requestsPerHour,
      requestsPerSecond: integration.requestsPerSecond,
      burstCapacity: integration.burstCapacity,
      logoSlug: integration.logoSlug,
    }),
  };
}

/**
 * Whether the integration authenticates as a GitHub App. Its credentials live
 * in `github_apps` rows (app id, installation ids, a private-key ref), none of
 * which a stub carries — so setting a secret is not enough to make an imported
 * one work; the App install flow has to be re-run on the target.
 */
export function isGithubAppIntegration(integration: {
  authType?: string;
}): boolean {
  return integration.authType === 'github-app';
}

export function isCustomIntegration(integration: IntegrationRow): boolean {
  return Boolean(integration.createdBy) && integration.createdBy !== 'system';
}

/**
 * A bundle-local filename for a rule, which has no slug of its own in the DB.
 * Pure: the caller reserves the name it gets, but only once the manifest it
 * belongs to has actually been built.
 */
export function ruleFilename(rule: RuleRow, taken: Set<string>): string {
  const base = slugify(rule.name) || 'rule';
  let candidate = base;
  for (let i = 2; taken.has(candidate); i += 1) {
    candidate = `${base}-${i}`;
  }
  return candidate;
}

function integrationSlugsIn(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      integrationSlugsIn(entry, found);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'integrationSlug' && typeof entry === 'string') {
        found.add(entry);
      } else {
        integrationSlugsIn(entry, found);
      }
    }
  }
}

export function collectIntegrationSlugs(manifests: Manifest[]): string[] {
  const found = new Set<string>();
  for (const manifest of manifests) {
    integrationSlugsIn(manifest.spec, found);
  }
  return [...found].sort();
}

const SECRET_KEY_PATTERN =
  /token|secret|password|passwd|passphrase|credential|authorization|api[-_]?key|private[-_]?key|pem|cert|signature|cookie/i;

/**
 * Credential-shaped keys that name a location or a reference instead of holding
 * a value: `tokenUrl`, `privateKeyPath`, `secretName`, and `apiKeyExpression` —
 * the false positive this heuristic always had. Widening the key pattern above
 * made them more likely, and the guard is only useful while its warnings are
 * worth reading.
 */
const LOCATION_OR_REFERENCE_KEY =
  /(path|file|filename|dir|directory|url|uri|endpoint|expression|field|type|name|id)$/i;

/**
 * A run long enough to be an actual credential rather than a scheme word.
 * `Bearer `, `Basic `, `token ` and the like survive; `ghp_…` does not.
 */
const CREDENTIAL_LIKE = /[A-Za-z0-9_\-.]{16,}/;

/**
 * A credential-shaped value is suspicious when it carries no `${REF}` at all
 * *or* when something credential-sized remains once the refs are removed —
 * `"Bearer ghp_realtoken ${UNUSED}"` used to pass simply because a `${` appeared
 * somewhere in it.
 */
function looksLikeLiteralSecret(value: string): boolean {
  if (secretRefsIn(value).length === 0) {
    return true;
  }
  return CREDENTIAL_LIKE.test(value.replace(/\$\{[^}]*\}/g, ' '));
}

function secretishValues(value: unknown, path: string, found: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, i) => secretishValues(entry, `${path}[${i}]`, found));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (
        SECRET_KEY_PATTERN.test(key) &&
        !LOCATION_OR_REFERENCE_KEY.test(key) &&
        typeof entry === 'string' &&
        looksLikeLiteralSecret(entry)
      ) {
        found.push(`${path}.${key}`);
      } else {
        secretishValues(entry, `${path}.${key}`, found);
      }
    }
  }
}

/**
 * Heuristic guard for the "secrets never serialize" convention. The system
 * stores secret VALUES out-of-band and references them as `${REF}`
 * placeholders — but nothing stops a hand-typed literal token in an auth
 * config or a node header. Flag anything that looks like one so the exporter
 * checks the bundle before sharing it. Warnings, not errors: keys like
 * `apiKeyExpression` can false-positive.
 */
export function secretExportWarnings(manifests: Manifest[]): string[] {
  const warnings: string[] = [];
  for (const manifest of manifests) {
    const label = `${manifest.kind} ${manifest.metadata.slug}`;
    if (manifest.kind === 'Integration') {
      const { authType, authConfig } = manifest.spec;
      if (isGithubAppIntegration({ authType: authType as string })) {
        // Not a leak — the opposite. Its credentials live outside authConfig
        // entirely, so the missing-placeholder warning below would be noise
        // while the real problem (a stub nobody can finish) went unsaid.
        warnings.push(
          `${label}: authenticates as a GitHub App — the stub carries no app registration, so the importer must re-run the GitHub App install`,
        );
      } else if (
        typeof authType === 'string' &&
        authType !== 'none' &&
        secretRefsIn(authConfig).length === 0
      ) {
        warnings.push(
          `${label}: authConfig has no \${SECRET_REF} placeholder — check for embedded credentials before sharing`,
        );
      }
    }
    const hits: string[] = [];
    secretishValues(manifest.spec, 'spec', hits);
    for (const hit of hits) {
      warnings.push(
        `${label}: ${hit} looks like a literal credential — verify before sharing`,
      );
    }
  }
  return warnings;
}

/**
 * An `@datasource:my-source` style token in a capability's instructions. These
 * are the one cross-reference the format does not rewrite — they live inside
 * prose, so they travel verbatim.
 */
// The slug body mirrors the server's own `^[a-z0-9]+(-[a-z0-9]+)*$` (and a
// legacy uuid), so it stops at prose: a trailing `.` in
// "…from @datasource:repos." belongs to the sentence, not the reference.
const CAPABILITY_REF_PATTERN =
  /@(datasource|action|context-group|capability):([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)/g;

const REFERENCED_KIND: Record<string, BundleKind> = {
  datasource: 'DataSource',
  action: 'Action',
  'context-group': 'ContextGroup',
  capability: 'Capability',
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Capability instructions reference other structures by slug, and nothing
 * rewrites or follows them. Two ways that goes wrong silently, both worth a
 * warning before the bundle is shared:
 *
 * - a legacy `@capability:<uuid>` token — the API still resolves those, so it
 *   works locally while breaking the format's "UUIDs never travel" promise;
 * - a reference to something the bundle omits, which imports as a dangling
 *   token (a cherry-picked capability is the common case).
 */
export function referenceWarnings(manifests: Manifest[]): string[] {
  const slugsByKind = new Map<BundleKind, Set<string>>();
  for (const manifest of manifests) {
    const slugs = slugsByKind.get(manifest.kind) ?? new Set<string>();
    slugs.add(manifest.metadata.slug);
    slugsByKind.set(manifest.kind, slugs);
  }

  const warnings: string[] = [];
  for (const manifest of manifests) {
    if (manifest.kind !== 'Capability') {
      continue;
    }
    const { instructions } = manifest.spec;
    if (typeof instructions !== 'string') {
      continue;
    }
    const label = `${manifest.kind} ${manifest.metadata.slug}`;
    const seen = new Set<string>();
    for (const [token, type, ref] of instructions.matchAll(
      CAPABILITY_REF_PATTERN,
    )) {
      if (seen.has(token)) {
        continue;
      }
      seen.add(token);
      if (UUID_PATTERN.test(ref)) {
        warnings.push(
          `${label}: instructions reference ${token} by UUID — re-point it at a slug, ids do not travel`,
        );
        continue;
      }
      if (!slugsByKind.get(REFERENCED_KIND[`${type}`])?.has(ref)) {
        warnings.push(
          `${label}: instructions reference ${token}, which this bundle does not include — it will import dangling`,
        );
      }
    }
  }
  return warnings;
}
