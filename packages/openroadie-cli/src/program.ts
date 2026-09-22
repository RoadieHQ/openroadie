import { Command, Option } from 'commander';
import { printFailure } from './print';
import { runStatus } from './commands/status';
import { runSetup } from './commands/setup';
import { runSecretSet, runSecretVerify } from './commands/secret';
import { runSourcesList, runSourcesEnable } from './commands/sources';
import {
  runRelationshipsSuggest,
  runRelationshipsApprove,
  runRelationshipsReject,
  runRelationshipsReset,
  runRelationshipsCreate,
  runRelationshipsList,
  runRelationshipsShow,
  runRelationshipsEdit,
  runRelationshipsApply,
  runRelationshipsDryRun,
  runRelationshipsLink,
  runReview,
  runGraph,
  type IntegrationBackedConfig,
} from './commands/relationships';
import { runRelationshipsPreview } from './commands/relationship-preview';
import { runQuery, runAgent } from './commands/query';
import {
  runCapabilitiesCreate,
  runCapabilitiesList,
} from './commands/capabilities';
import {
  runContextGroupsCreate,
  runContextGroupsList,
} from './commands/context-groups';
import {
  runIntegrationsList,
  runIntegrationsEnable,
} from './commands/integrations';
import { runBundleExport } from './commands/bundle/export';
import { runBundleImport, type CollisionMode } from './commands/bundle/import';
import { runConnect } from './commands/connect';
import { runIndex } from './commands/index-catalog';
import { runUp } from './commands/up';

/** Split a comma/space-separated id list — shell-proof batch (no zsh word-split). */
function splitIds(list?: string): string[] {
  return list ? list.split(/[,\s]+/).filter(Boolean) : [];
}

export function parseIntegrationConfig(
  value?: string,
): IntegrationBackedConfig | undefined {
  if (!value) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(value);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('--integration-config must be a JSON object');
  }
  return parsed as IntegrationBackedConfig;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('openroadie')
    .description(
      'Install CLI that drives a self-hosted OpenRoadie from zero to a live, ' +
        'agent-queryable catalog.',
    )
    .showHelpAfterError();

  program
    .command('up')
    .description('Bring a self-hosted OpenRoadie server online')
    .action(async () => {
      await runUp();
    });

  program
    .command('status')
    .description('Report live readiness and the next command to run')
    .action(async () => {
      await runStatus();
    });

  program
    .command('setup')
    .description('Launch the guided setup wizard')
    .allowUnknownOption()
    .argument('[args...]', 'Arguments forwarded to the wizard (e.g. --auto)')
    .action(async (args: string[]) => {
      await runSetup(args);
    });

  const integrations = program
    .command('integrations')
    .description('List and enable integrations');
  integrations
    .command('list')
    .description('List available integrations')
    .action(async () => {
      await runIntegrationsList();
    });
  integrations
    .command('enable')
    .argument('<ids...>', 'Integration ids to enable')
    .description('Enable one or more integrations')
    .action(async (ids: string[]) => {
      await runIntegrationsEnable(ids);
    });

  // Credential boundary: connect never accepts secrets; `secret set` is the only ingress.
  program
    .command('connect')
    .argument('<id>', 'Integration id to connect')
    .option('--confirm', 'Confirm a GitHub-App install after the callback')
    .description('Connect an enabled integration via its real auth flow')
    .action(async (id: string, opts: { confirm?: boolean }) => {
      await runConnect(id, { confirm: Boolean(opts.confirm) });
    });

  // Credential boundary: no --token flag; `set` reads via the hidden prompt only.
  const secret = program
    .command('secret')
    .description('Manage integration secrets (set via hidden prompt only)');
  secret
    .command('set')
    .argument('<id>', 'Integration id the secret belongs to')
    .description('Store a secret for an integration (hidden prompt)')
    .action(async (id: string) => {
      await runSecretSet(id);
    });
  secret
    .command('verify')
    .argument('<id>', 'Integration id whose secret to verify')
    .description('Verify a stored secret reaches its integration')
    .action((id: string) => runSecretVerify(id));

  const sources = program
    .command('sources')
    .description('List and enable data-source seeds');
  sources
    .command('list')
    .description('List seed data sources for enabled integrations')
    .action(async () => {
      await runSourcesList();
    });
  sources
    .command('enable')
    .option('--all', 'Enable every available source')
    .argument('[keys...]', 'Specific source keys to enable')
    .description('Enable data-source seeds')
    .action(async (keys: string[], opts: { all?: boolean }) => {
      await runSourcesEnable(keys, { all: Boolean(opts.all) });
    });

  program
    .command('index')
    .description('Index connected sources into the catalog')
    .action(async () => {
      await runIndex();
    });

  const relationships = program
    .command('relationships')
    .description(
      'Suggest, approve, reject, and create relationships ' +
        '(field-matching and integration-backed).',
    );
  relationships
    .command('suggest')
    .argument(
      '[datasourceIds...]',
      'Datasource UUIDs to suggest across (omit to use all enabled sources)',
    )
    .description(
      'Suggest relationship rules across the given data sources (or all enabled)',
    )
    .action(async (datasourceIds: string[]) => {
      await runRelationshipsSuggest(datasourceIds);
    });
  relationships
    .command('list')
    .description('List rules with source/target datasource names (triage view)')
    .option('--state <state>', 'suggested (default) | active | inactive | all')
    // Constrained, so a typo ("--band hgih") fails loudly instead of silently
    // returning zero rows — indistinguishable from "no rules in that band".
    .addOption(
      new Option('--band <band>', 'Only show one confidence band').choices([
        'high',
        'medium',
        'low',
      ]),
    )
    .action(async (opts: { state?: string; band?: string }) => {
      await runRelationshipsList({ state: opts.state, band: opts.band });
    });
  relationships
    .command('show')
    .description('Show one rule in full, with its scoring evidence')
    .argument('<id>', 'Rule id')
    .action(async (id: string) => {
      await runRelationshipsShow(id);
    });
  // Apply materializes rules against existing objects; never re-index to apply
  // because re-index re-fetches sources.
  relationships
    .command('apply')
    .description('Materialize rules against existing objects (no re-fetch)')
    .option('--all', 'Apply every active rule')
    .option('--ids <list>', 'Comma-separated rule ids')
    .argument('[ids...]', 'Specific rule ids to apply')
    .action(async (ids: string[], opts: { all?: boolean; ids?: string }) => {
      await runRelationshipsApply([...ids, ...splitIds(opts.ids)], {
        all: Boolean(opts.all),
      });
    });
  relationships
    .command('dry-run')
    .description(
      'Compute the edges a rule WOULD create without writing (works for suggested rules)',
    )
    .argument('<id>', 'Rule id to dry-run')
    .option(
      '--sample-limit <n>',
      'Cap source objects processed (integration-backed makes real calls; default 25)',
    )
    .action(async (id: string, opts: { sampleLimit?: string }) => {
      const sampleLimit =
        opts.sampleLimit !== undefined ? Number(opts.sampleLimit) : undefined;
      await runRelationshipsDryRun(id, { sampleLimit });
    });
  relationships
    .command('preview')
    .description(
      'Preview an UNSAVED rule — the only way to test a lookup rule without creating it',
    )
    .requiredOption('--source <uuid>', 'Source datasource UUID')
    .requiredOption('--target <uuid>', 'Target datasource UUID')
    .requiredOption('--source-field <expr>', 'jsonata on source')
    .requiredOption('--target-field <expr>', 'jsonata on target')
    .requiredOption(
      '--relationship <type>',
      'Relationship type (e.g. memberOf)',
    )
    .option(
      '--strategy <strategy>',
      'field-matching (default) | integration-backed',
    )
    .option(
      '--match-strategy <s>',
      'exact | contains | array_contains | regex | person_name_alias',
    )
    .option('--integration-config <json>', 'integration-backed only')
    .option('--source-filter <expr>', 'jsonata filter limiting source objects')
    .option('--target-filter <expr>', 'jsonata filter limiting target objects')
    .option(
      '--sample-limit <n>',
      'Cap source objects processed — integration-backed makes real calls (max 50); field-matching caps the previewed matches (default 25)',
    )
    .option(
      '--source-object <id>',
      'Preview a single source object (integration-backed only)',
    )
    .action(
      async (opts: {
        source: string;
        target: string;
        sourceField: string;
        targetField: string;
        relationship: string;
        strategy?: string;
        matchStrategy?: string;
        integrationConfig?: string;
        sourceFilter?: string;
        targetFilter?: string;
        sampleLimit?: string;
        sourceObject?: string;
      }) => {
        let integrationConfig: IntegrationBackedConfig | undefined;
        try {
          integrationConfig = parseIntegrationConfig(opts.integrationConfig);
        } catch (error: unknown) {
          const reason =
            error instanceof Error ? error.message : 'invalid JSON object';
          printFailure([`Invalid --integration-config: ${reason}`], {
            command: 'relationships preview',
            status: 'failed',
            reason: `invalid --integration-config: ${reason}`,
          });
          return;
        }
        await runRelationshipsPreview(
          {
            sourceDatasourceId: opts.source,
            targetDatasourceId: opts.target,
            sourceFieldExpression: opts.sourceField,
            targetFieldExpression: opts.targetField,
            relationshipType: opts.relationship,
            strategy: opts.strategy,
            matchStrategy: opts.matchStrategy,
            integrationConfig,
            sourceFilterExpression: opts.sourceFilter,
            targetFilterExpression: opts.targetFilter,
          },
          {
            sampleLimit:
              opts.sampleLimit !== undefined
                ? Number(opts.sampleLimit)
                : undefined,
            sourceObjectId: opts.sourceObject,
          },
        );
      },
    );
  relationships
    .command('link')
    .description(
      'Create a manual one-off relationship between two existing objects (no rule)',
    )
    .requiredOption('--source <uuid>', 'Source datasource UUID')
    .requiredOption('--source-object <id>', 'Source object id')
    .requiredOption('--target <uuid>', 'Target datasource UUID')
    .requiredOption('--target-object <id>', 'Target object id')
    .requiredOption(
      '--relationship <type>',
      'Relationship type (e.g. memberOf)',
    )
    .option('--reciprocal <type>', 'Reciprocal relationship type')
    .option('--metadata <json>', 'Optional JSON object stored on the edge')
    .action(
      async (opts: {
        source: string;
        sourceObject: string;
        target: string;
        targetObject: string;
        relationship: string;
        reciprocal?: string;
        metadata?: string;
      }) => {
        await runRelationshipsLink({
          sourceDatasourceId: opts.source,
          sourceObjectId: opts.sourceObject,
          targetDatasourceId: opts.target,
          targetObjectId: opts.targetObject,
          relationshipType: opts.relationship,
          reciprocalRelationshipType: opts.reciprocal,
          metadata: opts.metadata,
        });
      },
    );
  relationships
    .command('create')
    .description(
      'Author a relationship rule (field-matching, or integration-backed)',
    )
    .requiredOption('--name <name>', 'Descriptive rule name')
    .requiredOption('--source <uuid>', 'Source datasource UUID')
    .requiredOption('--target <uuid>', 'Target datasource UUID')
    .requiredOption(
      '--source-field <expr>',
      'jsonata on source — match field, or the extraction expr for integration-backed',
    )
    .requiredOption(
      '--target-field <expr>',
      'jsonata on target — the value to match against',
    )
    .requiredOption(
      '--relationship <type>',
      'Relationship type (e.g. memberOf)',
    )
    .option('--reciprocal <type>', 'Reciprocal relationship type')
    .option(
      '--strategy <strategy>',
      'field-matching (default) | integration-backed',
    )
    .option(
      '--match-strategy <s>',
      'field-matching only: exact | contains | array_contains | regex | person_name_alias',
    )
    .option(
      '--integration-config <json>',
      'integration-backed only: {"integrationId","path","responseMatchExpression","method?","metadataExpression?","pathExpression?","sourceContext?"}',
    )
    .option('--description <text>', 'What this rule captures')
    .option('--source-filter <expr>', 'jsonata filter limiting source objects')
    .option('--target-filter <expr>', 'jsonata filter limiting target objects')
    .option(
      '--state <state>',
      'suggested | active — omit to use the server default',
    )
    .action(
      async (opts: {
        name: string;
        source: string;
        target: string;
        sourceField: string;
        targetField: string;
        relationship: string;
        reciprocal?: string;
        strategy?: string;
        matchStrategy?: string;
        integrationConfig?: string;
        description?: string;
        sourceFilter?: string;
        targetFilter?: string;
        state?: string;
      }) => {
        let integrationConfig: IntegrationBackedConfig | undefined;
        try {
          integrationConfig = parseIntegrationConfig(opts.integrationConfig);
        } catch (error: unknown) {
          const reason =
            error instanceof Error ? error.message : 'invalid JSON object';
          printFailure([`Invalid --integration-config: ${reason}`], {
            command: 'relationships create',
            status: 'failed',
            reason: `invalid --integration-config: ${reason}`,
          });
          return;
        }
        await runRelationshipsCreate({
          name: opts.name,
          sourceDatasourceId: opts.source,
          targetDatasourceId: opts.target,
          sourceFieldExpression: opts.sourceField,
          targetFieldExpression: opts.targetField,
          relationshipType: opts.relationship,
          reciprocalRelationshipType: opts.reciprocal,
          strategy: opts.strategy as
            | 'field-matching'
            | 'integration-backed'
            | undefined,
          matchStrategy: opts.matchStrategy as
            | 'exact'
            | 'contains'
            | 'array_contains'
            | 'regex'
            | 'person_name_alias'
            | undefined,
          integrationConfig,
          description: opts.description,
          sourceFilterExpression: opts.sourceFilter,
          targetFilterExpression: opts.targetFilter,
          state: opts.state as 'suggested' | 'active' | undefined,
        });
      },
    );
  relationships
    .command('edit')
    .description(
      'Edit a rule in place — correct a suggestion before approving it (keeps its score/evidence); ' +
        'the source/target datasources and the strategy cannot be changed. ' +
        'Only the flags you pass change; use the --clear-* flags to empty a field ' +
        '(an empty string is rejected, never a clear).',
    )
    .argument('<id>', 'Rule id')
    .option('--name <name>', 'Rule name')
    .option('--description <text>', 'What this rule captures')
    .option('--relationship <type>', 'Relationship type (e.g. memberOf)')
    .option('--reciprocal <type>', 'Reciprocal relationship type')
    .option(
      '--match-strategy <s>',
      'exact | contains | array_contains | regex | person_name_alias',
    )
    .option('--source-field <expr>', 'jsonata on source')
    .option('--target-field <expr>', 'jsonata on target')
    .option('--source-filter <expr>', 'jsonata filter limiting source objects')
    .option('--target-filter <expr>', 'jsonata filter limiting target objects')
    .option(
      '--integration-config <json>',
      'integration-backed only: {"integrationId","path","responseMatchExpression",...}',
    )
    // Clearing needs its own flag: `--source-filter ''` used to store an empty
    // string, and the four nullable fields are the only ones that can be
    // emptied at all. Each conflicts with its value flag, so a call can't both
    // set and clear one field.
    .addOption(
      new Option('--clear-description', 'Clear the description').conflicts(
        'description',
      ),
    )
    .addOption(
      new Option(
        '--clear-reciprocal',
        'Drop the reciprocal relationship type',
      ).conflicts('reciprocal'),
    )
    .addOption(
      new Option(
        '--clear-source-filter',
        'Remove the source filter (consider every source object)',
      ).conflicts('sourceFilter'),
    )
    .addOption(
      new Option(
        '--clear-target-filter',
        'Remove the target filter (consider every target object)',
      ).conflicts('targetFilter'),
    )
    .action(
      async (
        id: string,
        opts: {
          name?: string;
          description?: string;
          relationship?: string;
          reciprocal?: string;
          matchStrategy?: string;
          sourceField?: string;
          targetField?: string;
          sourceFilter?: string;
          targetFilter?: string;
          integrationConfig?: string;
          clearDescription?: boolean;
          clearReciprocal?: boolean;
          clearSourceFilter?: boolean;
          clearTargetFilter?: boolean;
        },
      ) => {
        let integrationConfig: IntegrationBackedConfig | undefined;
        try {
          integrationConfig = parseIntegrationConfig(opts.integrationConfig);
        } catch (error: unknown) {
          const reason =
            error instanceof Error ? error.message : 'invalid JSON object';
          printFailure([`Invalid --integration-config: ${reason}`], {
            command: 'relationships edit',
            status: 'failed',
            reason: `invalid --integration-config: ${reason}`,
          });
          return;
        }
        // `null` is the backend's "clear this field"; `undefined` leaves it be.
        const clearable = <T>(value: T | undefined, clear?: boolean) =>
          clear ? null : value;
        await runRelationshipsEdit(id, {
          name: opts.name,
          description: clearable(opts.description, opts.clearDescription),
          relationshipType: opts.relationship,
          reciprocalRelationshipType: clearable(
            opts.reciprocal,
            opts.clearReciprocal,
          ),
          matchStrategy: opts.matchStrategy,
          sourceFieldExpression: opts.sourceField,
          targetFieldExpression: opts.targetField,
          sourceFilterExpression: clearable(
            opts.sourceFilter,
            opts.clearSourceFilter,
          ),
          targetFilterExpression: clearable(
            opts.targetFilter,
            opts.clearTargetFilter,
          ),
          integrationConfig,
        });
      },
    );
  relationships
    .command('approve')
    .option('--all', 'Approve every suggested rule')
    .option('--ids <list>', 'Comma-separated rule ids (shell-proof, one call)')
    .argument('[ids...]', 'Specific rule ids to approve')
    .description(
      'Approve suggested relationship rules (→ active); sends every id in one request and may dismiss mirrored suggestions',
    )
    .action(async (ids: string[], opts: { all?: boolean; ids?: string }) => {
      await runRelationshipsApprove([...ids, ...splitIds(opts.ids)], {
        all: Boolean(opts.all),
      });
    });
  relationships
    .command('reject')
    .option('--all', 'Reject every suggested rule')
    .option('--ids <list>', 'Comma-separated rule ids (shell-proof, one call)')
    .argument('[ids...]', 'Specific rule ids to reject')
    .description(
      'Reject suggested rules (→ inactive). Permanent: future `suggest` runs will not ' +
        're-propose them — undo with `relationships reset`.',
    )
    .action(async (ids: string[], opts: { all?: boolean; ids?: string }) => {
      await runRelationshipsReject([...ids, ...splitIds(opts.ids)], {
        all: Boolean(opts.all),
      });
    });
  relationships
    .command('reset')
    .description(
      'Return rejected/disabled rules to review (inactive → suggested)',
    )
    .option('--ids <list>', 'Comma-separated rule ids')
    .argument('[ids...]', 'Specific rule ids to reset')
    .action(async (ids: string[], opts: { ids?: string }) => {
      await runRelationshipsReset([...ids, ...splitIds(opts.ids)]);
    });

  program
    .command('review')
    .description('Show suggested relationship rules awaiting review')
    .action(async () => {
      await runReview();
    });

  program
    .command('graph')
    .description('Open the relationships graph in the browser')
    .action(async () => {
      await runGraph();
    });

  const capabilities = program
    .command('capabilities')
    .description('Create and list reusable agent capabilities');
  capabilities
    .command('create')
    .description('Create a capability (reusable agent instruction set)')
    .requiredOption('--name <name>', 'Capability name')
    .requiredOption('--description <text>', 'Short summary')
    .requiredOption('--instructions <markdown>', 'Full instructions (markdown)')
    .action(
      async (opts: {
        name: string;
        description: string;
        instructions: string;
      }) => {
        await runCapabilitiesCreate(opts);
      },
    );
  capabilities
    .command('list')
    .description('List capabilities')
    .action(async () => {
      await runCapabilitiesList();
    });

  const contextGroups = program
    .command('context-groups')
    .description('Create and list context-group rules (object clusters)');
  contextGroups
    .command('create')
    .description('Create a context-group rule (one group per object)')
    .requiredOption('--name <name>', 'Rule name')
    .option('--description <text>', 'What this group captures')
    .requiredOption(
      '--datasource <uuid...>',
      'Datasource UUID(s) whose objects form the groups',
    )
    .option(
      '--merge <type...>',
      'Relationship type(s) that merge related objects into one group',
    )
    .action(
      async (opts: {
        name: string;
        description?: string;
        datasource: string[];
        merge?: string[];
      }) => {
        await runContextGroupsCreate({
          name: opts.name,
          description: opts.description,
          datasources: opts.datasource.map(id => ({ datasourceId: id })),
          mergeRelationshipTypes: opts.merge,
        });
      },
    );
  contextGroups
    .command('list')
    .description('List context-group rules')
    .action(async () => {
      await runContextGroupsList();
    });

  const bundle = program
    .command('bundle')
    .description('Export and import shareable bundles of structures');
  bundle
    .command('export')
    .description('Export structures as a YAML bundle directory')
    .option('--datasource <slug...>', 'Datasource root(s) by slug')
    .option('--context-group <slug...>', 'Context-group root(s) by slug')
    .option('--capability <slug...>', 'Capability root(s) by slug')
    .option('--rule <idOrName...>', 'Relationship-rule root(s) by id or name')
    .option(
      '--no-follow-rules',
      'Do not pull in rules between included datasources',
    )
    .option(
      '--no-follow-datasources',
      'Do not pull in datasources referenced by roots',
    )
    .option('--include-data', 'Include stored objects for exported datasources')
    .requiredOption('-o, --out <dir>', 'Output bundle directory')
    .action(
      async (opts: {
        datasource?: string[];
        contextGroup?: string[];
        capability?: string[];
        rule?: string[];
        followRules: boolean;
        followDatasources: boolean;
        includeData?: boolean;
        out: string;
      }) => {
        const roots = {
          datasources: opts.datasource ?? [],
          contextGroups: opts.contextGroup ?? [],
          capabilities: opts.capability ?? [],
          rules: opts.rule ?? [],
        };
        const all = Object.values(roots).every(list => list.length === 0);
        await runBundleExport(
          {
            ...roots,
            all,
            followRules: opts.followRules,
            followDatasources: opts.followDatasources,
            includeData: Boolean(opts.includeData),
          },
          opts.out,
        );
      },
    );

  bundle
    .command('import')
    .description('Import a YAML bundle directory')
    .argument('<dir>', 'Bundle directory to import')
    .option('--dry-run', 'Print the plan without writing')
    .option('--only <item...>', 'Import only these items (<kind-dir>/<slug>)')
    .option('--exclude <item...>', 'Skip these items (<kind-dir>/<slug>)')
    .option('--force', 'Overwrite items that already exist')
    // Opposite instructions for the same situation: taking one silently would
    // either overwrite what the user asked to keep, or keep what they asked to
    // overwrite.
    .addOption(
      new Option('--skip-existing', 'Skip items that already exist').conflicts(
        'force',
      ),
    )
    .action(
      async (
        dir: string,
        opts: {
          dryRun?: boolean;
          only?: string[];
          exclude?: string[];
          force?: boolean;
          skipExisting?: boolean;
        },
      ) => {
        const mode: CollisionMode = opts.force
          ? 'force'
          : opts.skipExisting
            ? 'skip-existing'
            : 'fail';
        await runBundleImport(dir, {
          dryRun: Boolean(opts.dryRun),
          only: opts.only ?? [],
          exclude: opts.exclude ?? [],
          mode,
        });
      },
    );

  program
    .command('query')
    .argument('<question>', 'The question to ask the catalog')
    .description('Query the live catalog over MCP')
    .action(async (question: string) => {
      await runQuery(question);
    });

  program
    .command('agent')
    .description('Emit the MCP client config for your coding agent')
    .action(() => runAgent());

  return program;
}
