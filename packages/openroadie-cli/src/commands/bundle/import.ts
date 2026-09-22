import ora from 'ora';
import { loadConfig } from '../../config';
import { OpenRoadieHttpClient } from '../../http-client';
import { printFailure, printResult } from '../../print';
import {
  fetchActions,
  fetchCapabilities,
  fetchContextGroups,
  fetchIntegrations,
  fetchRelationships,
  fetchRules,
  fetchWorkflows,
} from './api';
import { parseBundleDir } from './import-parse';
import {
  buildImportPlan,
  type CollisionMode,
  type ImportPlan,
} from './import-plan';
import { applyImportPlan } from './import-apply';

/**
 * CLI runner for `openroadie bundle import`: read the bundle, plan against the
 * live environment, then either print the plan (--dry-run) or apply it. The
 * parsing, planning, and applying logic lives in the sibling modules.
 */
export { parseBundleDir, type ParsedBundle } from './import-parse';
export {
  buildImportPlan,
  isSameRule,
  type CollisionMode,
  type ImportPlan,
  type ImportSelection,
  type PlanAction,
  type PlanItem,
} from './import-plan';
export { applyImportPlan, type ApplyReport } from './import-apply';

/** `2 failures`, `1 invalid file`, or '' for none. */
function count(n: number, noun: string): string {
  return n === 0 ? '' : `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function planLines(plan: ImportPlan): string[] {
  const width = Math.max(...plan.items.map(i => i.action.length), 6);
  const lines = plan.items.map(i => {
    const notes = i.notes.length > 0 ? `  (${i.notes.join('; ')})` : '';
    return `  ${i.action.padEnd(width)}  ${i.dir}/${i.slug}${notes}`;
  });
  for (const err of plan.parseErrors) {
    lines.push(`  invalid   ${err.file}: ${err.message}`);
  }
  if (plan.missingIntegrations.length > 0) {
    lines.push(
      `Missing integrations on target: ${plan.missingIntegrations.join(', ')}`,
    );
  }
  return lines;
}

export async function runBundleImport(
  dir: string,
  opts: {
    dryRun: boolean;
    only: string[];
    exclude: string[];
    mode: CollisionMode;
  },
  client: OpenRoadieHttpClient = new OpenRoadieHttpClient(loadConfig()),
): Promise<void> {
  const spinner = ora('Reading bundle…').start();
  try {
    const bundle = await parseBundleDir(dir);
    // A format version this CLI does not know makes the target irrelevant —
    // fail before reading it, and identically for --dry-run and a live import.
    if (bundle.fatal) {
      throw new Error(bundle.fatal);
    }
    const [
      workflows,
      integrations,
      rules,
      contextGroups,
      capabilities,
      actions,
      relationships,
    ] = await Promise.all([
      fetchWorkflows(client),
      fetchIntegrations(client),
      fetchRules(client),
      fetchContextGroups(client),
      fetchCapabilities(client),
      fetchActions(client),
      bundle.items.some(item => item.kind === 'DirectRelationship')
        ? fetchRelationships(client)
        : Promise.resolve([]),
    ]);
    const target = {
      workflows,
      integrations,
      rules,
      contextGroups,
      capabilities,
      actions,
      directRelationships: relationships,
    };
    const plan = buildImportPlan(
      bundle,
      target,
      { only: opts.only, exclude: opts.exclude },
      opts.mode,
    );

    // A mistyped selector selects nothing, which would otherwise read as a
    // clean import of zero items. Fail before planning is acted on.
    if (plan.unknownSelectors.length > 0) {
      throw new Error(
        `no bundle item matches: ${plan.unknownSelectors.join(', ')} (expected <kind-dir>/<slug>)`,
      );
    }

    if (opts.dryRun) {
      // A plan that would not apply cleanly (conflicts, invalid files) must not
      // report `ok` — agents and CI key off this status and the exit code.
      if (!plan.ok) {
        spinner.fail(`Plan for ${bundle.manifest.name} is not applicable`);
        const lines = planLines(plan);
        if (plan.items.some(i => i.action === 'conflict')) {
          lines.push(
            'Re-run with --force to overwrite or --skip-existing to skip.',
          );
        }
        printFailure(lines, {
          command: 'bundle import',
          status: 'failed',
          plan,
        });
        return;
      }
      spinner.succeed(`Plan for ${bundle.manifest.name} (dry-run)`);
      printResult(planLines(plan), {
        command: 'bundle import',
        status: 'ok',
        plan,
      });
      return;
    }

    if (bundle.items.length === 0 && bundle.errors.length > 0) {
      throw new Error(
        `bundle has no importable items (${bundle.errors.length} invalid files)`,
      );
    }

    const conflicts = plan.items.filter(i => i.action === 'conflict');
    if (conflicts.length > 0) {
      spinner.fail('Import blocked by conflicts');
      printFailure(
        [
          ...planLines(plan),
          'Re-run with --force to overwrite or --skip-existing to skip.',
        ],
        { command: 'bundle import', status: 'failed', plan },
      );
      return;
    }

    spinner.text = 'Applying bundle…';
    const report = await applyImportPlan(client, bundle, plan, target);
    if (report.status === 'failed') {
      const problems = [
        count(report.failed.length, 'failure'),
        count(report.invalid.length, 'invalid file'),
      ].filter(Boolean);
      spinner.fail(
        `Imported with ${problems.join(' and ')} (${report.created.length} created)`,
      );
    } else {
      spinner.succeed(
        `Imported ${report.created.length + report.overwritten.length} items from ${bundle.manifest.name}`,
      );
    }
    const lines = [
      ...report.created.map(i => `  created    ${i}`),
      ...report.overwritten.map(i => `  overwrote  ${i}`),
      ...report.skipped.map(i => `  skipped    ${i}`),
      ...report.failed.map(f => `  FAILED     ${f.item}: ${f.reason}`),
      ...report.invalid.map(e => `  INVALID    ${e.file}: ${e.message}`),
    ];
    if (report.finishSetup.length > 0) {
      lines.push('To finish setup:');
      lines.push(...report.finishSetup.map(s => `  - ${s}`));
    }
    (report.status === 'failed' ? printFailure : printResult)(lines, report);
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    spinner.fail('Could not import bundle');
    printFailure([`Failed to import bundle: ${reason}`], {
      command: 'bundle import',
      status: 'failed',
      reason,
    });
  }
}
