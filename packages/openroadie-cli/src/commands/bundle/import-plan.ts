import { isDeepStrictEqual } from 'node:util';
import {
  itemKey,
  KIND_DIRS,
  type BundleItem,
  type BundleKind,
  type RuleSpec,
} from './format';
import type { RelationshipRow, RuleRow } from './api';
import type { ExportRows } from './export';
import type { ParsedBundle } from './import-parse';

/**
 * Planning: decide, per bundle item, what the import would do to the target
 * environment. Pure — the CLI prints this as the dry-run plan and the apply
 * pass consumes it unchanged.
 */
export type PlanAction =
  | 'create'
  | 'overwrite'
  | 'skip-existing'
  | 'conflict'
  | 'skip-missing-prereq'
  | 'excluded';

export interface PlanItem {
  kind: BundleKind;
  dir: string;
  slug: string;
  name: string;
  action: PlanAction;
  notes: string[];
}

export interface ImportPlan {
  items: PlanItem[];
  missingIntegrations: string[];
  ok: boolean;
  parseErrors: ParsedBundle['errors'];
  /**
   * `--only` / `--exclude` values matching no item in the bundle. A typo would
   * otherwise silently select nothing and report a successful empty import.
   */
  unknownSelectors: string[];
}

export interface ImportSelection {
  only: string[];
  exclude: string[];
}

export type CollisionMode = 'fail' | 'force' | 'skip-existing';

/** Mirrors the seeders' dedupe tuple — rules have no unique name/slug. */
export function isSameRule(
  spec: Pick<
    RuleSpec,
    | 'sourceDatasourceSlug'
    | 'targetDatasourceSlug'
    | 'sourceFieldExpression'
    | 'targetFieldExpression'
    | 'relationshipType'
    | 'reciprocalRelationshipType'
  >,
  rule: RuleRow,
  datasourceSlugById: Map<string, string>,
): boolean {
  return (
    datasourceSlugById.get(rule.sourceDatasourceId) ===
      spec.sourceDatasourceSlug &&
    datasourceSlugById.get(rule.targetDatasourceId) ===
      spec.targetDatasourceSlug &&
    rule.sourceFieldExpression === spec.sourceFieldExpression &&
    rule.targetFieldExpression === spec.targetFieldExpression &&
    rule.relationshipType === spec.relationshipType &&
    (rule.reciprocalRelationshipType ?? undefined) ===
      (spec.reciprocalRelationshipType ?? undefined)
  );
}

/**
 * The identity an item resolves to on the target: its slug for every kind
 * except relationship rules, which have no slug in the DB and are matched by
 * the `isSameRule` tuple above. Two bundle files sharing one identity would
 * both write the same row, so the parser rejects the second.
 */
export function bundleIdentity(item: BundleItem): string {
  if (item.kind === 'DirectRelationship') {
    return JSON.stringify([
      item.kind,
      item.spec.sourceDatasourceSlug,
      item.spec.sourceObjectId,
      item.spec.destinationDatasourceSlug,
      item.spec.destinationObjectId,
      item.spec.relationshipType,
    ]);
  }
  if (item.kind !== 'RelationshipRule') {
    return `${item.kind}/${item.metadata.slug}`;
  }
  const { spec } = item;
  // JSON so a separator cannot appear inside a field expression and make two
  // different tuples look identical.
  return JSON.stringify([
    item.kind,
    spec.sourceDatasourceSlug,
    spec.targetDatasourceSlug,
    spec.sourceFieldExpression,
    spec.targetFieldExpression,
    spec.relationshipType,
    spec.reciprocalRelationshipType ?? null,
  ]);
}

/** How a duplicate identity reads in an error message. */
export function describeIdentity(item: BundleItem): string {
  if (item.kind === 'DirectRelationship') {
    return `duplicate DirectRelationship ${item.spec.sourceDatasourceSlug}:${item.spec.sourceObjectId} -> ${item.spec.destinationDatasourceSlug}:${item.spec.destinationObjectId} as ${item.spec.relationshipType}`;
  }
  if (item.kind !== 'RelationshipRule') {
    return `duplicate ${item.kind} slug "${item.metadata.slug}"`;
  }
  const { spec } = item;
  return `duplicate RelationshipRule ${spec.sourceDatasourceSlug}.${spec.sourceFieldExpression} -> ${spec.targetDatasourceSlug}.${spec.targetFieldExpression} as ${spec.relationshipType}`;
}

/** Slugs already present on the target, per kind. Rules are matched by tuple. */
type ExistingSlugs = Record<
  Exclude<BundleKind, 'RelationshipRule' | 'DirectRelationship'>,
  Set<string>
>;

export function buildImportPlan(
  bundle: ParsedBundle,
  target: ExportRows,
  selection: ImportSelection,
  mode: CollisionMode,
): ImportPlan {
  const datasourceSlugById = new Map(target.workflows.map(w => [w.id, w.slug]));
  const existingBySlug: ExistingSlugs = {
    DataSource: new Set(target.workflows.map(w => w.slug)),
    ContextGroup: new Set(target.contextGroups.map(g => g.slug)),
    Capability: new Set(target.capabilities.map(c => c.slug)),
    Action: new Set(target.actions.map(a => a.slug)),
    Integration: new Set(target.integrations.map(i => i.slug)),
  };

  const isSameDirectRelationship = (
    item: Extract<BundleItem, { kind: 'DirectRelationship' }>,
    relationship: RelationshipRow,
  ): boolean =>
    datasourceSlugById.get(relationship.sourceDatasourceId) ===
      item.spec.sourceDatasourceSlug &&
    relationship.sourceObjectId === item.spec.sourceObjectId &&
    datasourceSlugById.get(relationship.destinationDatasourceId) ===
      item.spec.destinationDatasourceSlug &&
    relationship.destinationObjectId === item.spec.destinationObjectId &&
    relationship.relationshipType === item.spec.relationshipType;

  const matchingDirectRelationship = (
    item: Extract<BundleItem, { kind: 'DirectRelationship' }>,
  ): RelationshipRow | undefined =>
    target.directRelationships.find(relationship =>
      isSameDirectRelationship(item, relationship),
    );

  const directRelationshipMatchesBundle = (
    item: Extract<BundleItem, { kind: 'DirectRelationship' }>,
    relationship: RelationshipRow,
  ): boolean =>
    (relationship.reciprocalRelationshipType ?? undefined) ===
      item.spec.reciprocalRelationshipType &&
    relationship.origin === (item.spec.origin ?? 'manual') &&
    isDeepStrictEqual(
      relationship.metadata ?? undefined,
      item.spec.metadata ?? undefined,
    );

  const selected = (item: BundleItem): boolean => {
    const key = itemKey(item);
    if (selection.exclude.includes(key)) {
      return false;
    }
    return selection.only.length === 0 || selection.only.includes(key);
  };

  const selectedItems = bundle.items.filter(selected);
  const selectedSlugsOfKind = (kind: BundleKind): Set<string> =>
    new Set(
      selectedItems.filter(i => i.kind === kind).map(i => i.metadata.slug),
    );
  const selectedDatasourceSlugs = selectedSlugsOfKind('DataSource');
  const selectedIntegrationSlugs = selectedSlugsOfKind('Integration');

  // "Available" = already on the target, or arriving earlier in this import.
  const datasourceAvailable = (slug: string): boolean =>
    selectedDatasourceSlugs.has(slug) || existingBySlug.DataSource.has(slug);
  const integrationAvailable = (slug: string): boolean =>
    existingBySlug.Integration.has(slug) || selectedIntegrationSlugs.has(slug);

  const existsOnTarget = (item: BundleItem): boolean => {
    if (item.kind === 'RelationshipRule') {
      return target.rules.some(r =>
        isSameRule(item.spec, r, datasourceSlugById),
      );
    }
    if (item.kind === 'DirectRelationship') {
      const matching = matchingDirectRelationship(item);
      return matching !== undefined && matching.ruleId == null;
    }
    return existingBySlug[item.kind].has(item.metadata.slug);
  };

  const items: PlanItem[] = bundle.items.map(item => {
    const notes: string[] = [];
    const base: Omit<PlanItem, 'action'> = {
      kind: item.kind,
      dir: KIND_DIRS[`${item.kind}`],
      slug: item.metadata.slug,
      name: item.metadata.name,
      notes,
    };
    if (!selected(item)) {
      return { ...base, action: 'excluded' };
    }

    // Hard prerequisites: a rule needs both datasources; an action or an
    // integration-backed rule needs its integration. A datasource with a
    // missing integration still imports (it just cannot run) — noted only.
    if (
      item.kind === 'RelationshipRule' ||
      item.kind === 'DirectRelationship'
    ) {
      const missing = [
        item.spec.sourceDatasourceSlug,
        item.kind === 'RelationshipRule'
          ? item.spec.targetDatasourceSlug
          : item.spec.destinationDatasourceSlug,
      ].filter(s => !datasourceAvailable(s));
      const neededIntegration =
        item.kind === 'RelationshipRule'
          ? item.spec.integrationConfig?.integrationSlug
          : undefined;
      if (
        typeof neededIntegration === 'string' &&
        !integrationAvailable(neededIntegration)
      ) {
        missing.push(`integration ${neededIntegration}`);
      }
      if (missing.length > 0) {
        notes.push(`missing: ${missing.join(', ')}`);
        return { ...base, action: 'skip-missing-prereq' };
      }
    }
    if (item.kind === 'Action') {
      const missing = item.spec.steps
        .map(s => s.integrationSlug)
        .filter(s => !integrationAvailable(s));
      if (missing.length > 0) {
        notes.push(`missing integrations: ${missing.join(', ')}`);
        return { ...base, action: 'skip-missing-prereq' };
      }
    }
    if (item.kind === 'DataSource') {
      for (const node of item.spec.nodes) {
        const slug = node.data.config.integrationSlug;
        if (typeof slug === 'string' && !integrationAvailable(slug)) {
          // Configuring it afterwards is not enough on its own: the node keeps
          // its `integrationSlug` but gets no id, and nothing resolves one to
          // the other later.
          notes.push(
            `integration ${slug} not configured — node left unlinked; configure it, then re-import with --force`,
          );
        }
      }
    }

    if (item.kind === 'DirectRelationship') {
      const matching = matchingDirectRelationship(item);
      if (matching?.ruleId) {
        notes.push(
          `matching edge belongs to relationship rule ${matching.ruleId}`,
        );
        return { ...base, action: 'conflict' };
      }
      if (matching && mode === 'force') {
        if (directRelationshipMatchesBundle(item, matching)) {
          notes.push('existing direct relationship already matches bundle');
          return { ...base, action: 'skip-existing' };
        }
        notes.push(
          'existing direct relationship differs and cannot be overwritten atomically',
        );
        return { ...base, action: 'conflict' };
      }
    }

    if (existsOnTarget(item)) {
      // Integration stubs carry placeholder auth; overwriting a configured
      // integration would clobber working credentials, so they are
      // create-only — even under --force.
      if (item.kind === 'Integration') {
        notes.push('existing integration kept — auth config never overwritten');
        return { ...base, action: 'skip-existing' };
      }
      if (mode === 'force') {
        return { ...base, action: 'overwrite' };
      }
      if (mode === 'skip-existing') {
        return { ...base, action: 'skip-existing' };
      }
      return { ...base, action: 'conflict' };
    }
    return { ...base, action: 'create' };
  });

  // Prerequisites listed in bundle.yaml that neither exist on the target nor
  // arrive as a selected stub.
  const missingIntegrations = bundle.manifest.prerequisites.integrations
    .map(i => i.slug)
    .filter(slug => !integrationAvailable(slug))
    .sort();

  const knownKeys = new Set(bundle.items.map(itemKey));
  const unknownSelectors = [
    ...new Set([...selection.only, ...selection.exclude]),
  ]
    .filter(key => !knownKeys.has(key))
    .sort();

  const ok =
    bundle.errors.length === 0 &&
    unknownSelectors.length === 0 &&
    !items.some(i => i.action === 'conflict');

  return {
    items,
    missingIntegrations,
    ok,
    parseErrors: bundle.errors,
    unknownSelectors,
  };
}
