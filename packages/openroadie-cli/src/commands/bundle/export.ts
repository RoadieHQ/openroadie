import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, basename } from 'node:path';
import ora from 'ora';
import { loadConfig } from '../../config';
import { OpenRoadieHttpClient } from '../../http-client';
import { printFailure, printResult } from '../../print';
import {
  fetchActions,
  fetchCapabilities,
  fetchCapability,
  fetchContextGroups,
  fetchDatasourceObjects,
  fetchDirectRelationships,
  fetchIntegrations,
  fetchRules,
  fetchWorkflows,
  type ActionRow,
  type CapabilityRow,
  type ContextGroupRow,
  type IntegrationRow,
  type PortableObject,
  type RelationshipRow,
  type RuleRow,
  type WorkflowRow,
} from './api';
import {
  API_VERSION,
  isManifestFile,
  isUsableAsFilename,
  KIND_DIRS,
  manifestPath,
  toYaml,
  type BundleManifest,
  type Manifest,
} from './format';
import {
  actionToManifest,
  buildSlugMaps,
  capabilityToManifest,
  collectIntegrationSlugs,
  contextGroupToManifest,
  datasourceToManifest,
  directRelationshipToManifest,
  integrationToManifest,
  isCustomIntegration,
  referenceWarnings,
  ruleFilename,
  ruleToManifest,
  secretExportWarnings,
  seedDatasourceSlug,
  type SlugMaps,
} from './portable';

export interface ExportSelection {
  datasources: string[];
  contextGroups: string[];
  capabilities: string[];
  rules: string[];
  all: boolean;
  followRules: boolean;
  followDatasources: boolean;
  includeData: boolean;
}

export interface ExportRows {
  workflows: WorkflowRow[];
  integrations: IntegrationRow[];
  rules: RuleRow[];
  contextGroups: ContextGroupRow[];
  capabilities: CapabilityRow[];
  actions: ActionRow[];
  directRelationships: RelationshipRow[];
}

interface ExportResult {
  command: 'bundle export';
  status: 'ok' | 'failed';
  files: string[];
  /** Manifests from a previous export that this one no longer emits. */
  removed?: string[];
  prerequisites: string[];
  warnings?: string[];
  reason?: string;
}

function contextGroupDatasourceIds(
  group: ContextGroupRow,
  maps: SlugMaps,
): string[] {
  return group.datasources.flatMap(filter => {
    if (
      typeof filter.datasourceId === 'string' &&
      maps.datasourceSlugById.has(filter.datasourceId)
    ) {
      return [filter.datasourceId];
    }
    // Either the seeder never bound this filter, so it keeps only `seedName`, or
    // its id is stale because the datasource was deleted. The datasource it means
    // may exist under that name anyway, and following it is what stops a
    // cherry-picked group from importing against a datasource the bundle omits.
    if (typeof filter.seedName === 'string') {
      const id = maps.datasourceIdBySlug.get(
        seedDatasourceSlug(maps, filter.seedName),
      );
      return id ? [id] : [];
    }
    return [];
  });
}

export interface BuildBundleResult {
  files: Map<string, string>;
  warnings: string[];
  /** Integration slugs the bundle depends on — also written to bundle.yaml. */
  prerequisites: string[];
}

/**
 * Pure planner: resolve the selection roots, walk the dependency graph
 * (context group → datasources → rules between included datasources; rule →
 * its two datasources), and emit the bundle as relPath → yaml text.
 */
export function buildBundle(
  rows: ExportRows,
  selection: ExportSelection,
  bundleName: string,
  objectsByDatasourceId: Map<string, PortableObject[]> = new Map(),
): BuildBundleResult {
  const maps = buildSlugMaps(rows.workflows, rows.integrations);
  const workflowBySlug = new Map(rows.workflows.map(w => [w.slug, w]));
  const groupBySlug = new Map(rows.contextGroups.map(g => [g.slug, g]));
  const capabilityBySlug = new Map(rows.capabilities.map(c => [c.slug, c]));

  const warnings: string[] = [];
  const unknown: string[] = [];
  const requireAll = <T>(
    keys: string[],
    lookup: (key: string) => T | undefined,
  ): T[] =>
    keys.flatMap(key => {
      const found = lookup(key);
      if (found === undefined) {
        unknown.push(key);
        return [];
      }
      return [found];
    });

  const selectedGroups = selection.all
    ? rows.contextGroups
    : requireAll(selection.contextGroups, s => groupBySlug.get(s));
  const selectedCapabilities = selection.all
    ? rows.capabilities
    : requireAll(selection.capabilities, s => capabilityBySlug.get(s));
  // Rules have no unique name — that is why the importer matches them by tuple
  // — so a `--rule <name>` root can denote several. Take all of them: keeping
  // only the first would silently drop rules the user named.
  const rootRules = selection.all
    ? rows.rules
    : selection.rules.flatMap(key => {
        const matches = rows.rules.filter(r => r.id === key || r.name === key);
        if (matches.length === 0) {
          unknown.push(key);
        } else if (matches.length > 1) {
          warnings.push(
            `rule root "${key}" matched ${matches.length} rules — all are exported`,
          );
        }
        return matches;
      });
  const rootDatasources = selection.all
    ? rows.workflows
    : requireAll(selection.datasources, s => workflowBySlug.get(s));
  if (unknown.length > 0) {
    throw new Error(`unknown export roots: ${unknown.join(', ')}`);
  }

  const datasourceIds = new Set(rootDatasources.map(w => w.id));
  if (!selection.all && selection.followDatasources) {
    for (const group of selectedGroups) {
      for (const id of contextGroupDatasourceIds(group, maps)) {
        datasourceIds.add(id);
      }
    }
    for (const r of rootRules) {
      datasourceIds.add(r.sourceDatasourceId);
      datasourceIds.add(r.targetDatasourceId);
    }
  }

  const ruleIds = new Set(rootRules.map(r => r.id));
  if (!selection.all && selection.followRules) {
    for (const r of rows.rules) {
      if (
        datasourceIds.has(r.sourceDatasourceId) &&
        datasourceIds.has(r.targetDatasourceId)
      ) {
        ruleIds.add(r.id);
      }
    }
  }

  const manifests: Manifest[] = [];
  // One broken row (e.g. a rule pointing at a deleted integration) must not
  // kill a whole dump — skip it and surface a warning instead. Returns whether
  // the manifest was kept, for callers that reserve a name per manifest.
  const tryManifest = (label: string, make: () => Manifest): boolean => {
    try {
      const manifest = make();
      // The slug becomes a path under --out, so check it here rather than at
      // write time: a rejected row is then a skip like any other, not a failed
      // export, and it never contributes prerequisites or secret warnings.
      if (!isUsableAsFilename(manifest.metadata.slug)) {
        throw new Error(
          `slug "${manifest.metadata.slug}" cannot be used as a filename`,
        );
      }
      manifests.push(manifest);
      return true;
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      warnings.push(`skipped ${label}: ${reason}`);
      return false;
    }
  };

  for (const w of rows.workflows) {
    if (datasourceIds.has(w.id)) {
      tryManifest(`datasource ${w.slug}`, () => {
        const manifest = datasourceToManifest(w, maps);
        if (selection.includeData) {
          manifest.spec.objects = objectsByDatasourceId.get(w.id) ?? [];
        }
        return manifest;
      });
    }
  }
  if (selection.includeData) {
    for (const relationship of rows.directRelationships) {
      if (
        datasourceIds.has(relationship.sourceDatasourceId) &&
        datasourceIds.has(relationship.destinationDatasourceId)
      ) {
        tryManifest(`direct relationship ${relationship.id}`, () =>
          directRelationshipToManifest(relationship, maps),
        );
      }
    }
  }
  const takenRuleNames = new Set<string>();
  for (const r of rows.rules) {
    if (!ruleIds.has(r.id)) {
      continue;
    }
    // Reserve the filename only once the manifest actually builds, so a skipped
    // rule doesn't leave a hole in the numbering (`x`, then `x-3`).
    const filename = ruleFilename(r, takenRuleNames);
    if (
      tryManifest(`rule "${r.name}"`, () => ruleToManifest(r, maps, filename))
    ) {
      takenRuleNames.add(filename);
    }
  }
  for (const g of selectedGroups) {
    tryManifest(`context-group ${g.slug}`, () =>
      contextGroupToManifest(g, maps),
    );
  }
  for (const c of selectedCapabilities) {
    tryManifest(`capability ${c.slug}`, () => capabilityToManifest(c));
  }
  if (selection.all) {
    // Nothing references actions, so they have no root flag; they travel only
    // in a full export.
    for (const a of rows.actions) {
      tryManifest(`action ${a.slug}`, () => actionToManifest(a, maps));
    }
  }

  // Stubs for user-created integrations: every one on a full dump, only the
  // referenced ones on a cherry-pick. Built-ins stay prerequisites-only.
  const referencedSlugs = new Set(collectIntegrationSlugs(manifests));
  for (const integration of rows.integrations) {
    if (
      isCustomIntegration(integration) &&
      (selection.all || referencedSlugs.has(integration.slug))
    ) {
      tryManifest(`integration ${integration.slug}`, () =>
        integrationToManifest(integration),
      );
    }
  }

  warnings.push(...secretExportWarnings(manifests));
  warnings.push(...referenceWarnings(manifests));

  const files = new Map<string, string>();
  for (const manifest of manifests) {
    files.set(
      manifestPath(manifest.kind, manifest.metadata.slug),
      toYaml(manifest),
    );
  }
  // Prerequisites are what the importer must supply, so an integration this
  // bundle carries as a stub is not one. Collecting every referenced slug listed
  // the stubs too, which told a reader of bundle.yaml to go and configure
  // something the bundle hands them.
  const stubbedSlugs = new Set(
    manifests.filter(m => m.kind === 'Integration').map(m => m.metadata.slug),
  );
  const prerequisites = collectIntegrationSlugs(manifests).filter(
    slug => !stubbedSlugs.has(slug),
  );
  const bundleManifest: BundleManifest = {
    apiVersion: API_VERSION,
    name: bundleName,
    prerequisites: { integrations: prerequisites.map(slug => ({ slug })) },
  };
  files.set('bundle.yaml', toYaml(bundleManifest));
  return { files, warnings, prerequisites };
}

/**
 * The exporter owns its output directory, so it must not be pointed at one that
 * is someone else's: a mistyped `--out` would otherwise have its contents pruned
 * below. Checked before anything is written, never after.
 */
async function assertBundleDirWritable(outDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(outDir);
  } catch {
    return; // absent — the export creates it
  }
  // A fresh git clone is the intended destination for a shared bundle, so its
  // scaffolding does not count as "occupied": dotfiles (`.git`, `.gitignore`)
  // and the usual repo top-level docs are ignored when deciding whether this
  // directory is someone else's.
  const REPO_SCAFFOLDING =
    /^(readme|license|licence|contributing|changelog)\b/i;
  const occupied = entries.filter(
    name => !name.startsWith('.') && !REPO_SCAFFOLDING.test(name),
  );
  if (occupied.length > 0 && !entries.includes('bundle.yaml')) {
    throw new Error(
      `${outDir} is not empty and is not a bundle directory (no bundle.yaml) — refusing to write into it`,
    );
  }
}

/**
 * Drop manifests this export no longer emits, because the importer loads *every*
 * `.yaml` under each kind directory: one left over from an earlier, wider export
 * is indistinguishable from one this export chose, and would be imported.
 *
 * Runs *after* the new files are written, not before. Pruning first meant a write
 * that failed part-way — a permission error, a full disk — left the directory
 * with the old manifests already deleted and the new bundle incomplete.
 * Returns the pruned paths for the caller to report.
 */
async function pruneStaleManifests(
  outDir: string,
  keep: Set<string>,
): Promise<string[]> {
  const removed: string[] = [];
  for (const kindDir of Object.values(KIND_DIRS)) {
    let names: string[];
    try {
      names = await readdir(join(outDir, kindDir));
    } catch {
      continue; // kind directory absent — fine
    }
    for (const name of names.filter(isManifestFile)) {
      const relPath = `${kindDir}/${name}`;
      if (!keep.has(relPath)) {
        await rm(join(outDir, relPath));
        removed.push(relPath);
      }
    }
  }
  return removed.sort();
}

export async function runBundleExport(
  selection: ExportSelection,
  outDir: string,
  client: OpenRoadieHttpClient = new OpenRoadieHttpClient(loadConfig()),
): Promise<void> {
  const spinner = ora('Exporting bundle…').start();
  try {
    const [
      workflows,
      integrations,
      rules,
      contextGroups,
      capabilityList,
      actions,
      directRelationships,
    ] = await Promise.all([
      fetchWorkflows(client),
      fetchIntegrations(client),
      fetchRules(client),
      fetchContextGroups(client),
      fetchCapabilities(client),
      fetchActions(client),
      selection.includeData
        ? fetchDirectRelationships(client)
        : Promise.resolve([]),
    ]);
    const wanted = selection.all
      ? capabilityList.map(c => c.slug)
      : selection.capabilities;
    // The list endpoint returns whole rows today, instructions included, so
    // this normally issues no extra requests. The per-capability fetch is the
    // fallback for a list that ever stops projecting `instructions` — without
    // it, such a change would silently export capabilities with no body.
    const capabilities = await Promise.all(
      capabilityList
        .filter(c => wanted.includes(c.slug))
        .map(async c =>
          c.instructions === undefined ? fetchCapability(client, c.slug) : c,
        ),
    );

    const rows = {
      workflows,
      integrations,
      rules,
      contextGroups,
      capabilities,
      actions,
      directRelationships,
    };
    const objectsByDatasourceId = new Map<string, PortableObject[]>();
    if (selection.includeData) {
      const selectedFiles = buildBundle(
        rows,
        { ...selection, includeData: false },
        basename(outDir),
      ).files;
      const selectedSlugs = new Set(
        [...selectedFiles.keys()]
          .filter(path => path.startsWith('datasources/'))
          .map(path => basename(path, '.yaml')),
      );
      await Promise.all(
        workflows
          .filter(workflow => selectedSlugs.has(workflow.slug))
          .map(async workflow => {
            objectsByDatasourceId.set(
              workflow.id,
              await fetchDatasourceObjects(client, workflow.id),
            );
          }),
      );
    }

    const { files, warnings, prerequisites } = buildBundle(
      rows,
      selection,
      basename(outDir),
      objectsByDatasourceId,
    );

    await assertBundleDirWritable(outDir);
    // `bundle.yaml` first, because it is what marks the directory as a bundle:
    // written last, a run that failed part-way left manifests behind with no
    // marker, and the next attempt refused to write into its own output.
    const ordered = [...files].sort(([a], [b]) =>
      a === 'bundle.yaml' ? -1 : b === 'bundle.yaml' ? 1 : a.localeCompare(b),
    );
    for (const [relPath, text] of ordered) {
      const absolute = join(outDir, relPath);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, text, 'utf8');
    }
    const removed = await pruneStaleManifests(outDir, new Set(files.keys()));

    spinner.succeed(`Exported ${files.size} files to ${outDir}`);
    const result: ExportResult = {
      command: 'bundle export',
      status: 'ok',
      files: [...files.keys()].sort(),
      removed,
      prerequisites,
      warnings,
    };
    printResult(
      [
        ...result.files.map(f => `  ${f}`),
        ...removed.map(f => `  removed  ${f}`),
        ...warnings.map(w => `  WARNING: ${w}`),
        prerequisites.length > 0
          ? `Requires integrations: ${prerequisites.join(', ')}`
          : 'No integration prerequisites.',
      ],
      result,
    );
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    spinner.fail('Could not export bundle');
    printFailure([`Failed to export bundle: ${reason}`], {
      command: 'bundle export',
      status: 'failed',
      files: [],
      prerequisites: [],
      reason,
    } satisfies ExportResult);
  }
}
