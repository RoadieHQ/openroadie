import {
  itemKey,
  secretRefsIn,
  type BundleItem,
  type BundleKind,
  type GroupFilterSpec,
  type PortableNode,
} from './format';
import { isGithubAppIntegration } from './portable';
import {
  applyRelationshipRule,
  createAction,
  createCapability,
  createContextGroup,
  createIntegration,
  createRule,
  createWorkflow,
  materializeContextGroup,
  replaceDatasourceObjects,
  upsertDirectRelationship,
  transitionRelationshipRule,
  updateAction,
  updateCapability,
  updateContextGroup,
  updateRule,
  updateWorkflow,
  type RuleRow,
  type RuleTransition,
} from './api';
import type { OpenRoadieHttpClient } from '../../http-client';
import type { ExportRows } from './export';
import type { ParsedBundle } from './import-parse';
import { isSameRule, type ImportPlan, type PlanAction } from './import-plan';

/**
 * Applying: turn a plan into API writes. Slug references resolve to real ids
 * here — including ids of items created earlier in this same run, which is
 * why the kinds are written in dependency order.
 */
export interface ApplyReport {
  command: 'bundle import';
  status: 'ok' | 'failed';
  created: string[];
  overwritten: string[];
  skipped: string[];
  failed: Array<{ item: string; reason: string }>;
  /**
   * Bundle files that never parsed, so never became plan items. Carried here so
   * a run that silently dropped part of the bundle cannot report itself clean.
   */
  invalid: Array<{ file: string; message: string }>;
  finishSetup: string[];
}

const APPLY_ORDER: BundleKind[] = [
  'Integration',
  'DataSource',
  'DirectRelationship',
  'RelationshipRule',
  'ContextGroup',
  'Action',
  'Capability',
];

/** Kinds identified by slug — relationship rules are matched by tuple instead. */
type SluggedKind = Exclude<
  BundleKind,
  'RelationshipRule' | 'DirectRelationship'
>;

interface ResolutionState {
  integrationIdBySlug: Map<string, string>;
  datasourceIdBySlug: Map<string, string>;
  existingIdBySlug: Record<SluggedKind, Map<string, string>>;
  existingRule: (
    item: Extract<BundleItem, { kind: 'RelationshipRule' }>,
  ) => RuleRow | undefined;
  /** Collected while writing, consumed by the post-import pass. */
  appliedRuleIds: string[];
  materializedGroupIds: string[];
  createdIntegrations: Array<{
    slug: string;
    secretRefs: string[];
    githubApp: boolean;
  }>;
  /** Writes that landed but left something for the operator to finish. */
  partialNotes: string[];
}

export type RuleState = 'suggested' | 'active' | 'inactive';

/**
 * The rules API exposes no "set state" — only these one-way verbs, each of
 * which 409s unless the rule is in its exact source state:
 *
 *   suggested --approve--> active     active   --disable--> inactive
 *   suggested --dismiss--> inactive   inactive --reset----> suggested
 *
 * Two of the six moves therefore need a second hop, hence the explicit paths.
 */
const TRANSITIONS: Record<RuleState, Record<RuleState, RuleTransition[]>> = {
  suggested: { suggested: [], active: ['approve'], inactive: ['dismiss'] },
  active: {
    suggested: ['disable', 'reset'],
    active: [],
    inactive: ['disable'],
  },
  inactive: {
    suggested: ['reset'],
    active: ['reset', 'approve'],
    inactive: [],
  },
};

function asRuleState(value: string): RuleState {
  if (value === 'active' || value === 'inactive' || value === 'suggested') {
    return value;
  }
  throw new Error(`unknown relationship-rule state "${value}"`);
}

/** Where each verb leaves the rule — how a partial walk is reported. */
const STATE_AFTER: Record<RuleTransition, RuleState> = {
  approve: 'active',
  dismiss: 'inactive',
  reset: 'suggested',
  disable: 'inactive',
};

interface DriveResult {
  /** The state the rule is actually in now, mid-path failure included. */
  state: RuleState;
  /**
   * Whether the walk ended by approving: approve already applies the rule
   * server-side, and a second apply would churn its edges.
   */
  applied: boolean;
  error?: string;
}

/**
 * Walk a rule from its current state to the desired one. A failed hop is
 * returned rather than thrown, because the caller has to report the state the
 * rule actually reached — two of the six moves take two hops, so the starting
 * state is not where a half-finished walk leaves it.
 */
async function driveRuleState(
  client: OpenRoadieHttpClient,
  ruleId: string,
  from: RuleState,
  to: RuleState,
): Promise<DriveResult> {
  let state = from;
  let applied = false;
  for (const transition of TRANSITIONS[`${from}`][`${to}`]) {
    try {
      await transitionRelationshipRule(client, ruleId, transition);
    } catch (e: unknown) {
      return {
        state,
        applied,
        error: e instanceof Error ? e.message : String(e),
      };
    }
    state = STATE_AFTER[`${transition}`];
    applied = transition === 'approve';
  }
  return { state, applied };
}

/**
 * On overwrite the bundle is the desired state, so a field the bundle omits
 * must be sent as an explicit null: these update APIs write a column only when
 * its key is present, so an absent key would leave the stale value in place.
 *
 * Not applied to actions (their update schema is `z.string().optional()`, so
 * null is rejected) or capabilities (which always carry a non-empty
 * description).
 */
function clearedWhenAbsent<T>(
  value: T | undefined,
  overwrite: boolean,
): T | null | undefined {
  return overwrite ? (value ?? null) : value;
}

function requireExistingId(
  state: ResolutionState,
  kind: SluggedKind,
  slug: string,
): string {
  const id = state.existingIdBySlug[`${kind}`].get(slug);
  if (!id) {
    throw new Error(`no existing ${kind} ${slug} to overwrite`);
  }
  return id;
}

function resolveNodes(
  nodes: PortableNode[],
  state: ResolutionState,
): PortableNode[] {
  return nodes.map(node => {
    const { integrationSlug, ...config } = node.data.config;
    if (typeof integrationSlug !== 'string') {
      return node;
    }
    const id = state.integrationIdBySlug.get(integrationSlug);
    // Missing integration: keep the symbolic `integrationSlug`, the way
    // context-group filters keep `seedName`. Dropping it would destroy the
    // reference for good — nothing resolves a slug to an id after the fact, and
    // `portableNode` derives `integrationSlug` only from an `integrationId`, so
    // a later export from this environment would silently lose which
    // integration the node wanted.
    if (!id) {
      return node;
    }
    return {
      ...node,
      data: { ...node.data, config: { ...config, integrationId: id } },
    };
  });
}

async function applyItem(
  client: OpenRoadieHttpClient,
  item: BundleItem,
  action: PlanAction,
  state: ResolutionState,
): Promise<void> {
  const overwrite = action === 'overwrite';
  const { slug, name, description } = item.metadata;
  const desired = <T>(value: T | undefined) =>
    clearedWhenAbsent(value, overwrite);

  switch (item.kind) {
    case 'Integration': {
      // Create-only: the plan never emits overwrite for integrations.
      const created = await createIntegration(client, {
        name,
        slug,
        ...item.spec,
      });
      state.integrationIdBySlug.set(slug, created.id);
      // A stub only carries `${REF}` placeholders, never secret values, so the
      // importer has to be told which secrets to set before it can be used.
      state.createdIntegrations.push({
        slug,
        secretRefs: secretRefsIn(item.spec),
        githubApp: isGithubAppIntegration(item.spec),
      });
      return;
    }

    case 'DataSource': {
      const body = {
        name,
        slug,
        description: desired(description),
        workflowType: item.spec.workflowType,
        enabled: item.spec.enabled,
        viewport: item.spec.viewport,
        edges: item.spec.edges,
        nodes: resolveNodes(item.spec.nodes, state),
      };
      const existingId = overwrite
        ? requireExistingId(state, 'DataSource', slug)
        : undefined;
      state.datasourceIdBySlug.delete(slug);
      const id = existingId ?? (await createWorkflow(client, body)).id;
      if (overwrite) {
        await updateWorkflow(client, id, body);
      }
      if (item.spec.objects !== undefined) {
        await replaceDatasourceObjects(client, id, item.spec.objects);
      }
      state.datasourceIdBySlug.set(slug, id);
      return;
    }

    case 'DirectRelationship': {
      const sourceDatasourceId = state.datasourceIdBySlug.get(
        item.spec.sourceDatasourceSlug,
      );
      const destinationDatasourceId = state.datasourceIdBySlug.get(
        item.spec.destinationDatasourceSlug,
      );
      if (!sourceDatasourceId || !destinationDatasourceId) {
        throw new Error('direct relationship datasources are not resolvable');
      }
      await upsertDirectRelationship(client, {
        sourceDatasourceId,
        sourceObjectId: item.spec.sourceObjectId,
        destinationDatasourceId,
        destinationObjectId: item.spec.destinationObjectId,
        relationshipType: item.spec.relationshipType,
        reciprocalRelationshipType: item.spec.reciprocalRelationshipType,
        origin: item.spec.origin ?? 'manual',
        metadata: item.spec.metadata,
      });
      return;
    }

    case 'RelationshipRule': {
      const { spec } = item;
      const sourceDatasourceId = state.datasourceIdBySlug.get(
        spec.sourceDatasourceSlug,
      );
      const targetDatasourceId = state.datasourceIdBySlug.get(
        spec.targetDatasourceSlug,
      );
      if (!sourceDatasourceId || !targetDatasourceId) {
        throw new Error(
          `datasources not resolvable: ${spec.sourceDatasourceSlug} / ${spec.targetDatasourceSlug}`,
        );
      }
      let integrationConfig = spec.integrationConfig;
      if (integrationConfig) {
        const { integrationSlug, ...rest } = integrationConfig;
        if (typeof integrationSlug === 'string') {
          const id = state.integrationIdBySlug.get(integrationSlug);
          if (!id) {
            throw new Error(`integration ${integrationSlug} not resolvable`);
          }
          integrationConfig = { integrationId: id, ...rest };
        }
      }
      const body = {
        name,
        description: desired(description),
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression: spec.sourceFieldExpression,
        targetFieldExpression: spec.targetFieldExpression,
        sourceFilterExpression: desired(spec.sourceFilterExpression),
        targetFilterExpression: desired(spec.targetFilterExpression),
        relationshipType: spec.relationshipType,
        reciprocalRelationshipType: desired(spec.reciprocalRelationshipType),
        strategy: spec.strategy,
        matchStrategy: spec.matchStrategy,
        integrationConfig: desired(integrationConfig),
        // Create accepts only active|suggested and update ignores state
        // entirely; the transition below is what actually sets the state.
        // An intended-inactive rule is therefore created `suggested`, never
        // `active`: both reach inactive in one hop (dismiss / disable), but if
        // that hop fails, a leftover `suggested` rule is inert while a leftover
        // `active` one gets applied by the next datasource run — writing the
        // very edges the bundle asked to keep switched off.
        state: spec.state === 'inactive' ? 'suggested' : spec.state,
        origin: 'api',
      };

      let ruleId: string;
      let currentState: RuleState;
      if (overwrite) {
        const existing = state.existingRule(item);
        if (!existing) {
          throw new Error(`no matching existing rule for ${name}`);
        }
        await updateRule(client, existing.id, body);
        ruleId = existing.id;
        currentState = asRuleState(existing.state);
      } else {
        ruleId = (await createRule(client, body)).id;
        // Create honoured the capped state, not necessarily the desired one.
        currentState = asRuleState(body.state);
      }

      // The row itself is written by now. A transition that 409s (the rule
      // moved under us) must not report the whole item as failed — that would
      // claim nothing happened. Note the leftover state instead.
      const drive = await driveRuleState(
        client,
        ruleId,
        currentState,
        asRuleState(spec.state),
      );
      if (drive.error) {
        state.partialNotes.push(
          `rule ${name} written but left in state ${drive.state} (wanted ${spec.state}): ${drive.error}`,
        );
        return;
      }
      // Reaching `active` via approve already applies the rule server-side;
      // otherwise an already-active rule still needs the post-import apply.
      if (spec.state === 'active' && !drive.applied) {
        state.appliedRuleIds.push(ruleId);
      }
      return;
    }

    case 'ContextGroup': {
      // Unresolved refs stay symbolic via seedName: the backend resolves it by
      // workflow name first and then by slug, and slugify() leaves an
      // already-slug value untouched, so the slug written here binds through
      // that second branch once the datasource appears.
      const resolveFilter = (filter: GroupFilterSpec) => {
        const { datasourceSlug, ...rest } = filter;
        const id = state.datasourceIdBySlug.get(datasourceSlug);
        return id
          ? { datasourceId: id, ...rest }
          : { seedName: datasourceSlug, ...rest };
      };
      const body = {
        name,
        slug,
        description: desired(description),
        datasources: item.spec.datasources.map(resolveFilter),
        mergeRelationshipTypes: item.spec.mergeRelationshipTypes,
        annotations: item.spec.annotations,
        includeExternalRelations: item.spec.includeExternalRelations,
      };
      const id = overwrite
        ? requireExistingId(state, 'ContextGroup', slug)
        : (await createContextGroup(client, body)).id;
      if (overwrite) {
        await updateContextGroup(client, id, body);
      }
      // Both the create and the patch materialize server-side, but they run
      // before the post-import pass applies the rules — so a group whose members
      // depend on those edges would come out empty. Re-materialize afterwards.
      state.materializedGroupIds.push(id);
      return;
    }

    case 'Action': {
      const steps = item.spec.steps.map(step => {
        const { integrationSlug, ...rest } = step;
        const id = state.integrationIdBySlug.get(integrationSlug);
        if (!id) {
          throw new Error(`integration ${integrationSlug} not resolvable`);
        }
        return { ...rest, integrationId: id };
      });
      const body = {
        name,
        slug,
        description,
        parameters: item.spec.parameters,
        steps,
        enabled: item.spec.enabled,
      };
      if (overwrite) {
        await updateAction(
          client,
          requireExistingId(state, 'Action', slug),
          body,
        );
        return;
      }
      await createAction(client, body);
      return;
    }

    case 'Capability': {
      const body = {
        name,
        slug,
        // PUT replaces the whole capability, so an absent description cannot be
        // left to the server.
        description: description || name,
        instructions: item.spec.instructions,
      };
      if (overwrite) {
        await updateCapability(
          client,
          requireExistingId(state, 'Capability', slug),
          body,
        );
        return;
      }
      await createCapability(client, body);
      return;
    }
  }
}

function initialState(target: ExportRows): ResolutionState {
  const slugById = new Map(target.workflows.map(w => [w.id, w.slug]));
  return {
    integrationIdBySlug: new Map(target.integrations.map(i => [i.slug, i.id])),
    datasourceIdBySlug: new Map(target.workflows.map(w => [w.slug, w.id])),
    existingIdBySlug: {
      DataSource: new Map(target.workflows.map(w => [w.slug, w.id])),
      ContextGroup: new Map(target.contextGroups.map(g => [g.slug, g.id])),
      Capability: new Map(target.capabilities.map(c => [c.slug, c.id])),
      Action: new Map(target.actions.map(a => [a.slug, a.id])),
      Integration: new Map(target.integrations.map(i => [i.slug, i.id])),
    },
    appliedRuleIds: [],
    materializedGroupIds: [],
    createdIntegrations: [],
    partialNotes: [],
    existingRule: item =>
      target.rules.find(r => isSameRule(item.spec, r, slugById)),
  };
}

/**
 * Integrations that the imported datasources depend on, already present on the
 * target, but whose secrets do not resolve there (`readyForCurrentScope`).
 * Newly created stubs are excluded — they get their own line, naming the
 * secrets to set.
 */
/**
 * Integrations the operator still has to set up: a `bundle.yaml` prerequisite
 * the target does not have, plus any integration a written datasource's node
 * references that neither exists on the target nor arrived as a stub in this
 * run.
 *
 * The second half is not implied by the first. An integration the bundle ships
 * as a stub is deliberately not a prerequisite, so excluding that stub — via
 * `--only`/`--exclude` — leaves a node wanting an integration that no
 * prerequisite mentions. The datasource still imports, with its node unlinked,
 * and without this the report would say "run datasource X" and never say why
 * it cannot work yet.
 */
function integrationsToConfigure(
  bundle: ParsedBundle,
  plan: ImportPlan,
  report: ApplyReport,
  target: ExportRows,
  state: ResolutionState,
): string[] {
  const needed = new Set(plan.missingIntegrations);
  const written = new Set([...report.created, ...report.overwritten]);
  const justCreated = new Set(state.createdIntegrations.map(i => i.slug));
  const onTarget = new Set(target.integrations.map(i => i.slug));
  for (const item of bundle.items) {
    if (item.kind !== 'DataSource' || !written.has(itemKey(item))) {
      continue;
    }
    for (const node of item.spec.nodes) {
      const slug = node.data.config.integrationSlug;
      if (
        typeof slug === 'string' &&
        !justCreated.has(slug) &&
        !onTarget.has(slug)
      ) {
        needed.add(slug);
      }
    }
  }
  return [...needed].sort();
}

function unreadyIntegrations(
  bundle: ParsedBundle,
  report: ApplyReport,
  target: ExportRows,
  state: ResolutionState,
): string[] {
  const written = new Set([...report.created, ...report.overwritten]);
  const justCreated = new Set(state.createdIntegrations.map(i => i.slug));
  const unready = new Set<string>();
  for (const item of bundle.items) {
    if (item.kind !== 'DataSource' || !written.has(itemKey(item))) {
      continue;
    }
    for (const node of item.spec.nodes) {
      const slug = node.data.config.integrationSlug;
      if (typeof slug !== 'string' || justCreated.has(slug)) {
        continue;
      }
      const existing = target.integrations.find(i => i.slug === slug);
      if (existing?.readyForCurrentScope === false) {
        unready.add(slug);
      }
    }
  }
  return [...unready].sort();
}

const SKIPPED_ACTIONS: PlanAction[] = [
  'skip-existing',
  'skip-missing-prereq',
  'conflict',
];

export async function applyImportPlan(
  client: OpenRoadieHttpClient,
  bundle: ParsedBundle,
  plan: ImportPlan,
  target: ExportRows,
): Promise<ApplyReport> {
  const state = initialState(target);
  // Safe as a key because the parser rejects a second file claiming the same
  // `<kind-dir>/<slug>` — including two rule files with one slug and different
  // tuples, which would otherwise share an entry and apply one item's action to
  // both.
  const actionByKey = new Map(
    plan.items.map(i => [`${i.dir}/${i.slug}`, i.action]),
  );
  const report: ApplyReport = {
    command: 'bundle import',
    status: 'ok',
    created: [],
    overwritten: [],
    skipped: [],
    failed: [],
    invalid: bundle.errors,
    finishSetup: [],
  };

  for (const kind of APPLY_ORDER) {
    for (const item of bundle.items.filter(i => i.kind === kind)) {
      const key = itemKey(item);
      const action = actionByKey.get(key) ?? 'excluded';
      if (action === 'excluded' || SKIPPED_ACTIONS.includes(action)) {
        if (action !== 'excluded') {
          report.skipped.push(key);
        }
        continue;
      }
      try {
        await applyItem(client, item, action, state);
        (action === 'overwrite' ? report.overwritten : report.created).push(
          key,
        );
      } catch (e: unknown) {
        report.failed.push({
          item: key,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  report.finishSetup.push(...state.partialNotes);

  // Post-import: apply active rules and materialize groups. Failures here are
  // notes, not errors — the structures themselves exist either way.
  const note = (what: string, e: unknown): void => {
    report.finishSetup.push(
      `${what}: ${e instanceof Error ? e.message : String(e)}`,
    );
  };
  for (const id of state.appliedRuleIds) {
    try {
      await applyRelationshipRule(client, id);
    } catch (e: unknown) {
      note(`rule ${id} not applied`, e);
    }
  }
  for (const id of state.materializedGroupIds) {
    try {
      await materializeContextGroup(client, id);
    } catch (e: unknown) {
      note(`context group ${id} not materialized`, e);
    }
  }

  // Configuration first, then what to run — an imported datasource is useless
  // until the integration behind it can actually authenticate.
  for (const slug of integrationsToConfigure(
    bundle,
    plan,
    report,
    target,
    state,
  )) {
    report.finishSetup.push(
      `configure integration ${slug}, then re-import with --force to link the nodes that wanted it`,
    );
  }
  for (const { slug, secretRefs, githubApp } of state.createdIntegrations) {
    if (githubApp) {
      // A stub carries no app registration, so no amount of secret-setting
      // finishes this one — say so rather than implying it is a secret away.
      report.finishSetup.push(
        `install the GitHub App for the new integration ${slug} — a bundle cannot carry its app registration`,
      );
      continue;
    }
    report.finishSetup.push(
      secretRefs.length > 0
        ? `set secret ${secretRefs.join(', ')} for the new integration ${slug}`
        : `configure the new integration ${slug}`,
    );
  }
  for (const slug of unreadyIntegrations(bundle, report, target, state)) {
    report.finishSetup.push(
      `integration ${slug} exists but is not ready — check its secrets`,
    );
  }
  // Overwritten datasources need the run just as much as created ones: their
  // nodes changed, so whatever is in the store came from the old definition.
  for (const key of [...report.created, ...report.overwritten].filter(k =>
    k.startsWith('datasources/'),
  )) {
    const slug = key.replace('datasources/', '');
    const datasource = bundle.items.find(
      item => item.kind === 'DataSource' && item.metadata.slug === slug,
    );
    if (
      datasource?.kind === 'DataSource' &&
      datasource.spec.objects !== undefined
    ) {
      continue;
    }
    report.finishSetup.push(`run datasource ${slug} to populate it`);
  }
  report.status =
    report.failed.length > 0 || report.invalid.length > 0 ? 'failed' : 'ok';
  return report;
}
