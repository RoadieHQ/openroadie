import ora from 'ora';
import { loadConfig } from '../config';
import { httpFailureReason, OpenRoadieHttpClient } from '../http-client';
import { printResult, printFailure } from '../print';
import { ENDPOINTS } from '../status';
import { openUrl } from '../browser';

/*
 * Relationship rules — two backend strategies (epic 33699).
 *
 * FIELD-MATCHING: the engine matches shared field values across two datasources
 * (match_strategy: exact / contains / regex). `suggest` produces these;
 * `approve`/`reject` triage them.
 *
 * INTEGRATION-BACKED: bridges two datasources that share NO field — extract a
 * value from the source object, call an integration, match the response back to
 * a target object, and store the resolved data as edge metadata. The backend
 * evaluator (applyIntegrationBackedRule) materializes them. Author one with
 * `createRule({ strategy: 'integration-backed', integrationConfig })`.
 */

/** Page size for listing suggested rules — high enough to fetch every rule in
 *  one request so `--all` and `review` cover the whole set, not the API's
 *  default first 50. ponytail: paginate if a catalog ever exceeds this. */
const RULE_PAGE = 10000;

export type ConfidenceBand = 'high' | 'medium' | 'low';

interface SuggestionMatch {
  sourceDatasourceId?: string;
  targetDatasourceId?: string;
  sourceField?: string;
  targetField?: string;
  score?: number;
  confidenceBand?: ConfidenceBand;
}

interface SuggestionResultRow {
  datasourceId?: string;
  total?: number;
  suggestions?: SuggestionMatch[];
}

interface CreatedRule {
  id: string;
  state?: 'suggested' | 'active' | 'inactive';
  confidenceBand?: ConfidenceBand;
}

interface SuggestRelationshipsResponse {
  results?: SuggestionResultRow[];
  createdRules?: CreatedRule[];
  pairs?: Array<{
    datasourceIds: [string, string];
    suggestions: SuggestionMatch[];
  }>;
}

interface RuleRow {
  id: string;
  name?: string;
  state?: 'suggested' | 'active' | 'inactive';
  relationshipType?: string;
}

interface RulesListResponse {
  items?: RuleRow[];
  total?: number;
}

export interface RelationshipsSuggestResult {
  command: 'relationships suggest';
  status: 'suggested' | 'failed';
  datasourceIds: string[];
  createdRuleIds: string[];
  confidence: Record<ConfidenceBand, number>;
  needsReview: boolean;
  /** Suggestions grouped by unordered datasource pair; `[]` on backends that
   *  predate pair-scoped generation (never a claim of zero suggestions). */
  pairs: Array<{ datasourceIds: string[]; suggestionCount: number }>;
  reason?: string;
}

const EMPTY_CONFIDENCE: Record<ConfidenceBand, number> = {
  high: 0,
  medium: 0,
  low: 0,
};

/**
 * Resolve datasource UUIDs to their human ingestion-workflow names — shared by
 * every command that prints a datasource id (`list`, `suggest`). Falls back to
 * the id's first 8 characters when a workflow name is missing.
 */
async function fetchDatasourceNamer(
  client: OpenRoadieHttpClient,
): Promise<(id?: string) => string> {
  const res = await client.get<{ data?: Array<{ id: string; name: string }> }>(
    `${ENDPOINTS.workflows}?limit=300`,
  );
  const nameById = new Map(
    (res.body?.data ?? []).map(w => [w.id, w.name] as const),
  );
  return (id?: string) =>
    (id && nameById.get(id)) ?? (id ? id.slice(0, 8) : '?');
}

/**
 * POST `/api/catalog-datastore/schemas/suggest-relationships { datasourceIds }`,
 * read the created rules + per-match `confidenceBand`, and tally the bands. The
 * human-review gate (`needsReview`) trips when any suggestion lands below
 * "high" — that is the engine's real band, not a CLI heuristic.
 */
export async function suggestRelationships(
  client: OpenRoadieHttpClient,
  datasourceIds: string[],
): Promise<RelationshipsSuggestResult> {
  if (datasourceIds.length === 0) {
    return {
      command: 'relationships suggest',
      status: 'failed',
      datasourceIds: [],
      createdRuleIds: [],
      confidence: { ...EMPTY_CONFIDENCE },
      needsReview: false,
      pairs: [],
      reason: 'no datasource ids given',
    };
  }

  const res = await client.post<SuggestRelationshipsResponse>(
    ENDPOINTS.suggestRelationships,
    { datasourceIds },
  );

  if (!res.ok) {
    return {
      command: 'relationships suggest',
      status: 'failed',
      datasourceIds,
      createdRuleIds: [],
      confidence: { ...EMPTY_CONFIDENCE },
      needsReview: false,
      pairs: [],
      reason: httpFailureReason(res),
    };
  }

  // Tally confidence from the rules actually created (deduped + persisted),
  // not the raw per-source match suggestions: those count reciprocal and
  // suppressed matches across every source pair, so they overstate the real
  // rule count (e.g. "18 high" for 9 created rules). createRelationshipRule
  // returns the persisted row, so each created rule carries its confidenceBand.
  const created = res.body?.createdRules ?? [];
  const confidence: Record<ConfidenceBand, number> = { ...EMPTY_CONFIDENCE };
  for (const rule of created) {
    if (rule.confidenceBand) {
      confidence[rule.confidenceBand] += 1;
    }
  }
  const needsReview = confidence.medium > 0 || confidence.low > 0;

  // `pairs` is absent on backends that predate pair-scoped generation; an
  // empty list keeps the renderer from claiming zero suggestions.
  const pairs = (res.body?.pairs ?? []).map(p => ({
    datasourceIds: p.datasourceIds,
    suggestionCount: p.suggestions.length,
  }));

  return {
    command: 'relationships suggest',
    status: 'suggested',
    datasourceIds,
    createdRuleIds: created.map(rule => rule.id),
    confidence,
    needsReview,
    pairs,
  };
}

/**
 * Discover the datasources to suggest across when the user passes none: every
 * enabled data-ingestion workflow. The `index` command runs exactly this set
 * (`workflowType=data-ingestion`), so suggesting across the same set keeps the
 * two verbs consistent; `enabled=true` narrows to the sources actually wired up.
 * Both query params are honored by the backend workflows list route. This lets
 * `relationships suggest` work without a manual datasource-UUID hunt.
 */
export async function discoverEnabledDatasourceIds(
  client: OpenRoadieHttpClient,
): Promise<string[] | null> {
  const res = await client.get<{ data?: Array<{ id: string }> }>(
    `${ENDPOINTS.workflows}?workflowType=data-ingestion&enabled=true&limit=200`,
  );
  if (!res.ok) {
    return null;
  }
  return (res.body?.data ?? []).map(workflow => workflow.id);
}

export async function runRelationshipsSuggest(
  datasourceIds: string[],
): Promise<void> {
  const config = loadConfig();
  const client = new OpenRoadieHttpClient(config);
  const spinner = ora('Suggesting relationships…').start();

  let ids = datasourceIds;
  if (ids.length === 0) {
    const discovered = await discoverEnabledDatasourceIds(client);
    if (discovered === null) {
      spinner.fail('Could not list data sources');
      printFailure(
        ['Could not list data sources — is the backend reachable?'],
        {
          command: 'relationships suggest',
          status: 'failed',
          datasourceIds: [],
          createdRuleIds: [],
          confidence: { ...EMPTY_CONFIDENCE },
          needsReview: false,
          pairs: [],
          reason: 'failed to list data sources',
        },
      );
      return;
    }
    ids = discovered;
    if (ids.length === 0) {
      spinner.fail('No enabled data sources to suggest across');
      printFailure(['Enable data sources first: openroadie sources enable …'], {
        command: 'relationships suggest',
        status: 'failed',
        datasourceIds: [],
        createdRuleIds: [],
        confidence: { ...EMPTY_CONFIDENCE },
        needsReview: false,
        pairs: [],
        reason: 'no enabled data sources',
      });
      return;
    }
  }

  const result = await suggestRelationships(client, ids);

  if (result.status === 'failed') {
    spinner.fail('Could not suggest relationships');
    printFailure([`Failed to suggest relationships: ${result.reason}`], result);
    return;
  }

  spinner.succeed(`Created ${result.createdRuleIds.length} suggested rule(s)`);
  const dsName =
    result.pairs.length > 0 ? await fetchDatasourceNamer(client) : undefined;
  const pairLines = result.pairs.map(
    p =>
      `  ${dsName?.(p.datasourceIds[0])} ↔ ${dsName?.(p.datasourceIds[1])}: ${p.suggestionCount} suggestion${p.suggestionCount === 1 ? '' : 's'}`,
  );
  printResult(
    [
      `Suggested across ${result.datasourceIds.length} source(s): ${result.createdRuleIds.length} rule(s) created.`,
      ...pairLines,
      `Confidence — high: ${result.confidence.high}, medium: ${result.confidence.medium}, low: ${result.confidence.low}.`,
      result.needsReview
        ? 'Some suggestions are below high confidence — run "openroadie review" before approving.'
        : 'All suggestions are high confidence — safe to "relationships approve --all".',
    ],
    result,
  );
}

/**
 * Materialize rules against the EXISTING objects — POST /:id/apply per rule.
 * This is how you apply a rule WITHOUT re-ingesting: never re-index to apply
 * (re-index re-fetches every source, which needs live tokens and fails on a
 * seeded/demo catalog). `create` doesn't auto-apply, so run this after it.
 * `--all` applies every active rule. Integration-backed rules still call their
 * integration here, so a bridge over a non-public endpoint needs real auth.
 */
export async function runRelationshipsApply(
  ids: string[],
  opts: { all?: boolean },
): Promise<void> {
  const client = new OpenRoadieHttpClient(loadConfig());
  let targetIds = ids;
  if (opts.all) {
    const res = await client.get<RulesListResponse>(
      `${ENDPOINTS.relationshipRules}?state=active&limit=${RULE_PAGE}`,
    );
    if (!res.ok) {
      printFailure([`Could not list active rules: ${httpFailureReason(res)}`], {
        command: 'relationships apply',
        status: 'failed',
      });
      return;
    }
    targetIds = (res.body?.items ?? []).map(r => r.id);
  }
  if (targetIds.length === 0) {
    printResult(['No rules to apply (pass ids or --all).'], {
      command: 'relationships apply',
      status: 'noop',
    });
    return;
  }
  const spinner = ora(`Applying ${targetIds.length} rule(s)…`).start();
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const id of targetIds) {
    const res = await client.post(
      `${ENDPOINTS.relationshipRules}/${encodeURIComponent(id)}/apply`,
    );
    if (res.ok) succeeded.push(id);
    else failed.push({ id, reason: httpFailureReason(res) });
  }
  spinner.stop();
  printResult(
    [
      `Applied ${succeeded.length} rule(s); ${failed.length} failed.`,
      ...failed.map(f => `  failed ${f.id}: ${f.reason}`),
    ],
    {
      command: 'relationships apply',
      status:
        failed.length === 0 ? 'done' : succeeded.length ? 'partial' : 'failed',
      succeeded,
      failed,
    },
    failed.length > 0 ? 1 : 0,
  );
}

/**
 * Dry-run a rule — POST /:id/dry-run. Computes the edges the rule WOULD create
 * (for integration-backed rules this makes the live call + pathExpression +
 * graph traversal) WITHOUT writing anything, so it works for a suggested rule.
 * The intended flow: `create` (suggested) → `dry-run` → if the candidates look
 * right, approve/activate and `apply`. A dry-run makes real integration calls,
 * so `--sample-limit` (default 25 server-side) bounds how many sources it hits.
 */
export async function runRelationshipsDryRun(
  id: string,
  opts: { sampleLimit?: number },
): Promise<void> {
  const client = new OpenRoadieHttpClient(loadConfig());
  const query =
    opts.sampleLimit !== undefined
      ? `?sampleLimit=${encodeURIComponent(opts.sampleLimit)}`
      : '';
  const spinner = ora('Dry-running rule…').start();
  const res = await client.post<{
    created: number;
    deleted: number;
    candidates?: Array<{
      sourceObjectId: string;
      destinationObjectId: string;
      relationshipType: string;
    }>;
    skippedSources?: string[];
    truncated?: boolean;
    sampled?: number;
  }>(
    `${ENDPOINTS.relationshipRules}/${encodeURIComponent(id)}/dry-run${query}`,
  );
  spinner.stop();

  if (!res.ok || !res.body) {
    printFailure([`Dry-run failed: ${httpFailureReason(res)}`], {
      command: 'relationships dry-run',
      status: 'failed',
      reason: httpFailureReason(res),
    });
    return;
  }

  const body = res.body;
  const candidates = body.candidates ?? [];
  const skipped = body.skippedSources ?? [];
  printResult(
    [
      `Dry-run (no writes): ${body.created} candidate edge(s) from ${
        body.sampled ?? 0
      } source object(s)${
        body.truncated ? ' (truncated by --sample-limit)' : ''
      }; ${skipped.length} source(s) skipped.`,
      ...candidates
        .slice(0, 10)
        .map(c => `  ${c.sourceObjectId} → ${c.destinationObjectId}`),
    ],
    {
      command: 'relationships dry-run',
      status: 'done',
      created: body.created,
      candidates,
      skippedSources: skipped,
      truncated: body.truncated ?? false,
      sampled: body.sampled ?? 0,
    },
  );
}

interface LinkRelationshipInput {
  sourceDatasourceId: string;
  sourceObjectId: string;
  targetDatasourceId: string;
  targetObjectId: string;
  relationshipType: string;
  reciprocalRelationshipType?: string;
  metadata?: Record<string, unknown>;
}

interface LinkRelationshipResult {
  command: 'relationships link';
  status: 'done' | 'failed';
  id?: string;
  origin?: string;
  reason?: string;
}

export async function linkRelationship(
  client: OpenRoadieHttpClient,
  input: LinkRelationshipInput,
): Promise<LinkRelationshipResult> {
  const res = await client.put<{ id: string; origin: string }>(
    ENDPOINTS.relationships,
    {
      sourceDatasourceId: input.sourceDatasourceId,
      sourceObjectId: input.sourceObjectId,
      destinationDatasourceId: input.targetDatasourceId,
      destinationObjectId: input.targetObjectId,
      relationshipType: input.relationshipType,
      reciprocalRelationshipType: input.reciprocalRelationshipType,
      origin: 'manual',
      metadata: input.metadata,
    },
  );
  if (!res.ok || !res.body?.id) {
    return {
      command: 'relationships link',
      status: 'failed',
      reason: httpFailureReason(res),
    };
  }
  return {
    command: 'relationships link',
    status: 'done',
    id: res.body.id,
    origin: res.body.origin ?? 'manual',
  };
}

export async function runRelationshipsLink(opts: {
  sourceDatasourceId: string;
  sourceObjectId: string;
  targetDatasourceId: string;
  targetObjectId: string;
  relationshipType: string;
  reciprocalRelationshipType?: string;
  metadata?: string;
}): Promise<void> {
  let metadata: Record<string, unknown> | undefined;
  if (opts.metadata) {
    try {
      const parsed: unknown = JSON.parse(opts.metadata);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error('must be a JSON object');
      }
      metadata = parsed as Record<string, unknown>;
    } catch (error: unknown) {
      const reason =
        error instanceof Error ? error.message : 'invalid JSON object';
      printFailure([`Invalid --metadata: ${reason}`], {
        command: 'relationships link',
        status: 'failed',
        reason: `invalid --metadata: ${reason}`,
      });
      return;
    }
  }

  const client = new OpenRoadieHttpClient(loadConfig());
  const result = await linkRelationship(client, { ...opts, metadata });
  if (result.status === 'failed') {
    printFailure([`Failed to link: ${result.reason}`], result);
    return;
  }
  printResult(
    [
      `Linked ${opts.sourceObjectId} → ${opts.targetObjectId} as ${opts.relationshipType} (manual).`,
    ],
    result,
  );
}

interface RuleFull {
  id: string;
  name?: string;
  state?: string;
  strategy?: string;
  matchStrategy?: string;
  relationshipType?: string;
  sourceDatasourceId?: string;
  targetDatasourceId?: string;
  sourceFieldExpression?: string;
  targetFieldExpression?: string;
  confidenceBand?: string;
  score?: number;
  description?: string | null;
  suggestionKind?: string | null;
  reviewReason?: string | null;
  sourceFilterExpression?: string | null;
  targetFilterExpression?: string | null;
  reciprocalRelationshipType?: string | null;
  integrationConfig?: Record<string, unknown> | null;
  evidenceSummary?: {
    explanation?: string;
    topMatchedValues?: string[];
    distinctMatchedValueCount?: number;
    valueTypes?: string[];
    commonValuePenalty?: number;
    sourceFieldStats?: {
      distinctCount: number;
      rowCoverage: number;
      cardinalityRatio: number;
      looksEnumLike: boolean;
      isIdentifierLike: boolean;
    };
    targetFieldStats?: {
      distinctCount: number;
      rowCoverage: number;
      cardinalityRatio: number;
      looksEnumLike: boolean;
      isIdentifierLike: boolean;
    };
    sourceFieldSemantic?: string;
    targetFieldSemantic?: string;
    semanticCompatibility?: string;
    /** Present when a pre-scoring gate measured containment/cardinality before the field pair reached Fellegi-Sunter scoring. */
    gate?: {
      containment?: number;
      containmentDirection?: 'source-to-target' | 'target-to-source';
      containmentVerified?: boolean;
      referencedCardinalityRatio?: number;
      rescueHint?: string;
    };
    /** Per-signal Fellegi-Sunter score breakdown (signed log2 weights). Absent for gate-suppressed candidates — they are never FS-scored. */
    waterfall?: Array<{
      signal: string;
      fired: boolean;
      weight: number;
      detail?: string;
    }>;
    /** Present when this suggestion was recovered by the stage 4 rescue loop after its plain field-match failed a gate. */
    rescue?: {
      kind: 'transform' | 'filter';
      detail: string;
      originalField?: string;
    };
  } | null;
}

type EvidenceSummary = NonNullable<RuleFull['evidenceSummary']>;

export interface RelationshipsListResult {
  command: 'relationships list';
  status: 'ok' | 'failed';
  rules: Array<{
    id: string;
    state?: string;
    strategy?: string;
    matchStrategy?: string;
    confidenceBand?: string;
    score?: number;
    explanation?: string;
    source: string;
    target: string;
  }>;
  reason?: string;
}

/**
 * List relationship rules **with datasource names resolved** — the triage view.
 * The rules API speaks raw datasource UUIDs; this joins them to the ingestion
 * workflow names so the agent can judge each rule in one call (no per-id probing
 * or full-catalog dumps). One line per rule: id · state · band · src.field →
 * tgt.field. Defaults to the suggested rules (what triage acts on).
 */
export async function listRules(
  client: OpenRoadieHttpClient,
  opts: { state?: string; band?: string },
): Promise<RelationshipsListResult> {
  const state = opts.state ?? 'suggested';
  const q = state === 'all' ? '' : `state=${encodeURIComponent(state)}&`;
  const [rulesRes, dsName] = await Promise.all([
    client.get<{ items?: RuleFull[] }>(
      `${ENDPOINTS.relationshipRules}?${q}limit=${RULE_PAGE}`,
    ),
    fetchDatasourceNamer(client),
  ]);
  if (!rulesRes.ok) {
    return {
      command: 'relationships list',
      status: 'failed',
      rules: [],
      reason: httpFailureReason(rulesRes),
    };
  }
  const all = rulesRes.body?.items ?? [];
  const filtered = opts.band
    ? all.filter(r => r.confidenceBand === opts.band)
    : all;
  return {
    command: 'relationships list',
    status: 'ok',
    rules: filtered.map(r => ({
      id: r.id,
      state: r.state,
      strategy: r.strategy,
      matchStrategy: r.matchStrategy,
      confidenceBand: r.confidenceBand,
      score: r.score,
      explanation: r.evidenceSummary?.explanation,
      source: `${dsName(r.sourceDatasourceId)}.${r.sourceFieldExpression}`,
      target: `${dsName(r.targetDatasourceId)}.${r.targetFieldExpression}`,
    })),
  };
}

export async function runRelationshipsList(opts: {
  state?: string;
  band?: string;
}): Promise<void> {
  const result = await listRules(new OpenRoadieHttpClient(loadConfig()), opts);
  if (result.status === 'failed') {
    printFailure([`Failed to list rules: ${result.reason}`], result);
    return;
  }
  const state = opts.state ?? 'suggested';
  const lines = result.rules.flatMap(r => {
    const kind = r.strategy === 'integration-backed' ? 'INT' : r.matchStrategy;
    const score = typeof r.score === 'number' ? r.score.toFixed(2) : '    ';
    // The full id, not a prefix: the triage flow is "copy an id from `list`
    // into `show`/`edit`/`reject`", and a truncated id is rejected as a
    // malformed UUID by every one of them.
    const head = `${r.id} [${r.state}] ${r.confidenceBand ?? ''} ${score} ${kind}  ${r.source} → ${r.target}`;
    return r.explanation ? [head, `  ${r.explanation}`] : [head];
  });
  printResult(
    [
      `Relationship rules (${result.rules.length}, state=${state}${
        opts.band ? `, band=${opts.band}` : ''
      }):`,
      ...lines,
    ],
    result,
  );
}

export type FetchRuleOutcome =
  | { ok: true; rule: RuleFull }
  | { ok: false; notFound: boolean; status: number; reason: string };

/**
 * Fetch one rule, keeping "this id does not exist" apart from every other way
 * the request can fail. Collapsing them made `show` answer a 400 (a malformed
 * id), a 500 or an unreachable backend with "no such rule" — sending the caller
 * off to hunt for a rule that is sitting right there.
 */
export async function fetchRule(
  client: OpenRoadieHttpClient,
  id: string,
): Promise<FetchRuleOutcome> {
  const res = await client.get<RuleFull>(
    `${ENDPOINTS.relationshipRules}/${encodeURIComponent(id)}`,
  );
  if (res.ok && res.body) {
    return { ok: true, rule: res.body };
  }
  // A 2xx whose body did not parse is not a missing rule either.
  return {
    ok: false,
    notFound: res.status === 404,
    status: res.status,
    reason: res.ok ? 'response was not a rule object' : httpFailureReason(res),
  };
}

/**
 * The full rule plus its unabridged evidence — the CLI counterpart to the
 * review drawer. `list` deliberately shows only the one-line explanation.
 */
export async function runRelationshipsShow(id: string): Promise<void> {
  const client = new OpenRoadieHttpClient(loadConfig());
  const outcome = await fetchRule(client, id);
  if (!outcome.ok) {
    printFailure(
      outcome.notFound
        ? [`No relationship rule with id ${id}`]
        : [
            `Could not load relationship rule ${id}: ${outcome.reason}`,
            ...(outcome.status !== 0
              ? [`  HTTP status ${outcome.status}`]
              : []),
          ],
      {
        command: 'relationships show',
        status: 'failed',
        reason: outcome.notFound ? 'not found' : outcome.reason,
        httpStatus: outcome.status,
      },
    );
    return;
  }
  const rule = outcome.rule;
  const ev = rule.evidenceSummary;
  const lines = [
    `${rule.name} — ${rule.id}`,
    `  state         ${rule.state}${rule.reviewReason ? ` (${rule.reviewReason})` : ''}`,
    `  kind          ${rule.suggestionKind ?? '-'} · ${rule.strategy ?? 'field-matching'} · ${rule.matchStrategy ?? '-'}`,
    `  confidence    ${rule.confidenceBand ?? '-'}${typeof rule.score === 'number' ? ` (${rule.score.toFixed(2)})` : ''}`,
    `  relationship  ${rule.relationshipType}${rule.reciprocalRelationshipType ? ` / ${rule.reciprocalRelationshipType}` : ''}`,
    `  source        ${rule.sourceDatasourceId} ${rule.sourceFieldExpression}`,
    `  target        ${rule.targetDatasourceId} ${rule.targetFieldExpression}`,
  ];
  if (rule.sourceFilterExpression || rule.targetFilterExpression) {
    lines.push(
      `  filters       source: ${rule.sourceFilterExpression ?? '-'} · target: ${rule.targetFilterExpression ?? '-'}`,
    );
  }
  if (rule.integrationConfig) {
    lines.push(`  integration   ${JSON.stringify(rule.integrationConfig)}`);
  }
  if (ev) {
    lines.push(...formatEvidenceLines(ev));
  }
  printResult(lines, { command: 'relationships show', status: 'ok', rule });
}

/**
 * The `show` evidence block: the original explanation/value-types/samples
 * lines, plus — only when present — the gate/waterfall/rescue sections a
 * suggestion carries after the stage-6 evidence enrichment. Pulled out of
 * `runRelationshipsShow` so it can be asserted on directly instead of via
 * `printResult`'s stdout write.
 */
/** One line of `key value, key value, ...` for a source/target field-stats
 *  block — mirrors the `gate` section's comma-joined style below. */
function formatFieldStats(
  stats: NonNullable<EvidenceSummary['sourceFieldStats']>,
): string {
  return [
    `distinct ${stats.distinctCount}`,
    `coverage ${stats.rowCoverage.toFixed(3)}`,
    `cardinality ${stats.cardinalityRatio.toFixed(3)}`,
    `enum-like ${stats.looksEnumLike}`,
    `identifier-like ${stats.isIdentifierLike}`,
  ].join(', ');
}

export function formatEvidenceLines(ev: EvidenceSummary): string[] {
  const topMatchedValues = ev.topMatchedValues ?? [];
  const shownValues = topMatchedValues.slice(0, 8);
  const moreValues = topMatchedValues.length - shownValues.length;
  const lines = [
    '  evidence',
    `    ${ev.explanation ?? '-'}`,
    `    value types: ${(ev.valueTypes ?? []).join(', ') || '-'}`,
    `    distinct matched values: ${ev.distinctMatchedValueCount ?? '-'}`,
    `    common-value penalty: ${ev.commonValuePenalty ?? '-'}`,
    `    samples: ${shownValues.join(', ') || '-'}${
      moreValues > 0 ? ` … (+${moreValues} more)` : ''
    }`,
  ];

  if (ev.sourceFieldStats) {
    lines.push(`    source field: ${formatFieldStats(ev.sourceFieldStats)}`);
  }
  if (ev.targetFieldStats) {
    lines.push(`    target field: ${formatFieldStats(ev.targetFieldStats)}`);
  }
  if (
    ev.sourceFieldSemantic ||
    ev.targetFieldSemantic ||
    ev.semanticCompatibility
  ) {
    lines.push(
      `    semantic: source=${ev.sourceFieldSemantic ?? '-'}, target=${
        ev.targetFieldSemantic ?? '-'
      }, compatibility=${ev.semanticCompatibility ?? '-'}`,
    );
  }

  if (ev.waterfall?.length) {
    lines.push('    waterfall');
    for (const entry of ev.waterfall) {
      const sign = entry.weight >= 0 ? '+' : '';
      lines.push(
        `      ${entry.signal}  ${sign}${entry.weight.toFixed(3)}${
          entry.detail ? ` (${entry.detail})` : ''
        }`,
      );
    }
  }

  if (ev.gate) {
    const g = ev.gate;
    const parts: string[] = [];
    if (typeof g.containment === 'number') {
      parts.push(
        `containment ${g.containment.toFixed(3)}${
          g.containmentDirection ? ` (${g.containmentDirection})` : ''
        }`,
      );
    }
    if (typeof g.containmentVerified === 'boolean') {
      parts.push(`verified ${g.containmentVerified}`);
    }
    if (typeof g.referencedCardinalityRatio === 'number') {
      parts.push(
        `cardinality ratio ${g.referencedCardinalityRatio.toFixed(3)}`,
      );
    }
    if (parts.length) {
      lines.push(`    gate: ${parts.join(', ')}`);
    }
    if (g.rescueHint) {
      lines.push(`    gate rescue hint: ${g.rescueHint}`);
    }
  }

  if (ev.rescue) {
    lines.push(
      `    rescued via ${ev.rescue.kind}: ${ev.rescue.detail}${
        ev.rescue.originalField
          ? ` (originally ${ev.rescue.originalField})`
          : ''
      }`,
    );
  }

  return lines;
}

/**
 * `undefined` leaves a field alone; `null` clears it. Only the four fields
 * whose column is nullable accept `null` — the same contract the
 * `manage_relationship_rule_update` MCP tool exposes, so CLI and MCP clear a
 * field the same way. An empty string is never a value here: it would write
 * `""` over a live rule instead of clearing it.
 */
export interface RuleUpdatePatch {
  name?: string;
  description?: string | null;
  relationshipType?: string;
  reciprocalRelationshipType?: string | null;
  matchStrategy?: string;
  sourceFieldExpression?: string;
  targetFieldExpression?: string;
  sourceFilterExpression?: string | null;
  targetFilterExpression?: string | null;
  integrationConfig?: IntegrationBackedConfig;
}

/** The flag each patch field comes from, so an error names what the user typed. */
const EDIT_FLAGS: Record<keyof RuleUpdatePatch, string> = {
  name: '--name',
  description: '--description',
  relationshipType: '--relationship',
  reciprocalRelationshipType: '--reciprocal',
  matchStrategy: '--match-strategy',
  sourceFieldExpression: '--source-field',
  targetFieldExpression: '--target-field',
  sourceFilterExpression: '--source-filter',
  targetFilterExpression: '--target-filter',
  integrationConfig: '--integration-config',
};

/** The clearable fields, and the flag that clears each one. */
const CLEAR_FLAGS: Partial<Record<keyof RuleUpdatePatch, string>> = {
  description: '--clear-description',
  reciprocalRelationshipType: '--clear-reciprocal',
  sourceFilterExpression: '--clear-source-filter',
  targetFilterExpression: '--clear-target-filter',
};

/**
 * An empty string is a mistake, never an instruction. For a clearable field it
 * means "clear it" and would instead store `""`; for the rest — a relationship
 * type, a field expression — it would blank a live rule outright.
 */
function emptyStringError(patch: RuleUpdatePatch): string | undefined {
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value !== 'string' || value.trim() !== '') {
      continue;
    }
    const flag = EDIT_FLAGS[`${key}` as keyof RuleUpdatePatch] ?? `--${key}`;
    const clearFlag = CLEAR_FLAGS[`${key}` as keyof RuleUpdatePatch];
    return clearFlag
      ? `${flag} cannot be empty — pass ${clearFlag} to clear it`
      : `${flag} cannot be empty — omit it to leave it unchanged`;
  }
  return undefined;
}

/** Drop the flags the caller didn't pass, leaving only what actually changed.
 *  `null` survives: it is the explicit "clear this field" the backend expects. */
function definedPatchEntries(patch: RuleUpdatePatch): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined),
  );
}

/**
 * Edit a rule in place. Correcting a suggestion keeps its score and evidence;
 * delete-and-recreate loses both. The datasource pair (and `strategy`) is not
 * editable here — flipping field-matching ↔ integration-backed is effectively
 * a different rule and can strand it in a state its config cannot support.
 */
export async function updateRule(
  client: OpenRoadieHttpClient,
  id: string,
  patch: RuleUpdatePatch,
): Promise<{ ok: boolean; reason?: string; changed?: string[] }> {
  const emptyString = emptyStringError(patch);
  if (emptyString) {
    return { ok: false, reason: emptyString };
  }
  const body = definedPatchEntries(patch);
  const changed = Object.keys(body);
  if (changed.length === 0) {
    return { ok: false, reason: 'nothing to update — pass at least one flag' };
  }
  const res = await client.put(
    `${ENDPOINTS.relationshipRules}/${encodeURIComponent(id)}`,
    body,
  );
  return res.ok
    ? { ok: true, changed }
    : { ok: false, reason: httpFailureReason(res) };
}

export async function runRelationshipsEdit(
  id: string,
  patch: RuleUpdatePatch,
): Promise<void> {
  const client = new OpenRoadieHttpClient(loadConfig());
  const result = await updateRule(client, id, patch);
  if (!result.ok) {
    printFailure([`Failed to edit rule ${id}: ${result.reason}`], {
      command: 'relationships edit',
      status: 'failed',
      reason: result.reason,
    });
    return;
  }
  printResult(
    [`Rule ${id} updated. Re-check it with: relationships dry-run ${id}`],
    {
      command: 'relationships edit',
      status: 'ok',
      id,
      changed: result.changed ?? [],
    },
  );
}

/**
 * Resolve the rule ids a transition verb should act on. With `--all` the verb
 * first lists the `?state=suggested` rules and acts on every one; otherwise the
 * caller's explicit ids pass straight through. Approve then goes through the
 * bulk `/approve` route, reject through per-id POST `/:id/dismiss`.
 */
async function resolveRuleIds(
  client: OpenRoadieHttpClient,
  ids: string[],
  all: boolean | undefined,
): Promise<{ ids: string[]; listError?: string }> {
  if (!all) {
    return { ids };
  }
  // ponytail: fetch all suggested in one page (limit well above any real
  // catalog). The backend defaults to 50, so `--all` silently acted on only the
  // first 50; the explicit limit makes `--all` mean all. Upgrade to offset
  // pagination if a catalog ever exceeds RULE_PAGE.
  const res = await client.get<RulesListResponse>(
    `${ENDPOINTS.relationshipRules}?state=suggested&limit=${RULE_PAGE}`,
  );
  if (!res.ok) {
    return {
      ids: [],
      listError: res.unreachable
        ? 'backend unreachable'
        : `request failed (status ${res.status})`,
    };
  }
  return { ids: (res.body?.items ?? []).map(rule => rule.id) };
}

export interface RelationshipsTransitionResult {
  command:
    | 'relationships approve'
    | 'relationships reject'
    | 'relationships reset';
  status: 'done' | 'partial' | 'failed' | 'noop';
  targetState: 'active' | 'inactive' | 'suggested';
  succeeded: string[];
  /** Requested ids that did not transition — the caller's own failures. */
  failed: Array<{ id: string; reason: string }>;
  /** Mirrored suggestions the backend dismissed so approve would not duplicate an edge. */
  dismissedAsInverse?: string[];
  /**
   * Mirrors nobody requested that the backend could not suppress. They stay
   * `suggested` and want a manual reject, but nothing the caller asked for
   * failed — so they are reported apart from `failed` and never change the
   * exit code.
   */
  inverseDismissFailed?: Array<{ id: string; reason: string }>;
  /**
   * Why a `noop` happened. `nothing-to-do` is a satisfied request (`--all`
   * with no suggestions left); `no-ids-given` is a usage error — the caller
   * named nothing to act on.
   */
  noopKind?: 'nothing-to-do' | 'no-ids-given';
  reason?: string;
}

/**
 * Exit code for a finished transition. A per-id failure now arrives as an HTTP
 * 200 with that id in `failed`, so a partial failure is the ORDINARY failure
 * mode, not an exotic one: exiting 0 let `approve --all && apply --all` run to
 * completion and report a clean install with a third of the joins never
 * activated. Anything the caller asked for that did not happen is non-zero,
 * matching `relationships apply`. `inverseDismissFailed` is deliberately
 * excluded — those ids were never requested.
 */
function transitionExitCode(result: RelationshipsTransitionResult): number {
  if (result.status === 'noop') {
    return result.noopKind === 'no-ids-given' ? 1 : 0;
  }
  return result.failed.length > 0 ? 1 : 0;
}

/**
 * Reject/dismiss the given rule ids, each via its POST `/dismiss` route.
 * There is no bulk dismiss route — unlike approve, dismissing one id can't
 * strand another, so per-id is fine. With `--all` the verb first lists the
 * `?state=suggested` rules and rejects every one.
 */
async function transitionRules(
  client: OpenRoadieHttpClient,
  ids: string[],
  options: { all?: boolean },
): Promise<RelationshipsTransitionResult> {
  const command = 'relationships reject' as const;
  const targetState = 'inactive' as const;
  const verbPath = 'dismiss';

  const resolved = await resolveRuleIds(client, ids, options.all);
  if (resolved.listError) {
    return {
      command,
      status: 'failed',
      targetState,
      succeeded: [],
      failed: [],
      reason: resolved.listError,
    };
  }
  if (resolved.ids.length === 0) {
    return {
      command,
      status: 'noop',
      targetState,
      succeeded: [],
      failed: [],
      noopKind: options.all ? 'nothing-to-do' : 'no-ids-given',
      reason: options.all
        ? 'no suggested rules to act on'
        : 'no rule ids given',
    };
  }

  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const id of resolved.ids) {
    const res = await client.post(
      `${ENDPOINTS.relationshipRules}/${encodeURIComponent(id)}/${verbPath}`,
    );
    if (res.ok) {
      succeeded.push(id);
    } else {
      failed.push({ id, reason: httpFailureReason(res) });
    }
  }

  let status: RelationshipsTransitionResult['status'];
  if (failed.length === 0) {
    status = 'done';
  } else if (succeeded.length === 0) {
    status = 'failed';
  } else {
    status = 'partial';
  }

  return {
    command,
    status,
    targetState,
    succeeded,
    failed,
  };
}

/**
 * Approve goes through the bulk route in ONE request: the backend arbitrates
 * mirrored A→B / B→A suggestions across the whole batch, which it cannot do
 * one id at a time.
 */
export async function approveRules(
  client: OpenRoadieHttpClient,
  ids: string[],
  options: { all?: boolean },
): Promise<RelationshipsTransitionResult> {
  const base = {
    command: 'relationships approve' as const,
    targetState: 'active' as const,
    dismissedAsInverse: [] as string[],
  };
  const resolved = await resolveRuleIds(client, ids, options.all);
  if (resolved.listError) {
    return {
      ...base,
      status: 'failed',
      succeeded: [],
      failed: [],
      reason: resolved.listError,
    };
  }
  if (resolved.ids.length === 0) {
    return {
      ...base,
      status: 'noop',
      succeeded: [],
      failed: [],
      noopKind: options.all ? 'nothing-to-do' : 'no-ids-given',
      reason: options.all
        ? 'no suggested rules to act on'
        : 'no rule ids given',
    };
  }

  const res = await client.post<{
    approved: string[];
    dismissedAsInverse: string[];
    failed: Array<{ id: string; reason: string }>;
    inverseDismissFailed?: Array<{ id: string; reason: string }>;
  }>(`${ENDPOINTS.relationshipRules}/approve`, { ids: resolved.ids });

  if (!res.ok) {
    return {
      ...base,
      status: 'failed',
      succeeded: [],
      failed: [],
      reason: httpFailureReason(res),
    };
  }

  // A 200 with a missing/unparseable `approved` array is not "nothing
  // approved" — it's a response the CLI didn't understand, and reporting
  // `done` for it would claim success having approved nothing.
  if (!Array.isArray(res.body?.approved)) {
    return {
      ...base,
      status: 'failed',
      succeeded: [],
      failed: [],
      reason: 'approve response did not include a usable "approved" array',
    };
  }

  const approved = res.body.approved;
  // `failed` carries requested ids only, so it is the caller's failure count.
  // A mirror that could not be suppressed is a separate, unrequested problem.
  const failed = res.body?.failed ?? [];
  let status: RelationshipsTransitionResult['status'];
  if (failed.length === 0) {
    status = 'done';
  } else if (approved.length === 0) {
    status = 'failed';
  } else {
    status = 'partial';
  }
  return {
    ...base,
    status,
    succeeded: approved,
    failed,
    dismissedAsInverse: res.body?.dismissedAsInverse ?? [],
    inverseDismissFailed: res.body?.inverseDismissFailed ?? [],
  };
}

export async function rejectRules(
  client: OpenRoadieHttpClient,
  ids: string[],
  options: { all?: boolean },
): Promise<RelationshipsTransitionResult> {
  return transitionRules(client, ids, options);
}

/** inactive → suggested; the undo for `reject`. */
export async function resetRules(
  client: OpenRoadieHttpClient,
  ids: string[],
): Promise<RelationshipsTransitionResult> {
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const id of ids) {
    const res = await client.post(
      `${ENDPOINTS.relationshipRules}/${encodeURIComponent(id)}/reset`,
    );
    if (res.ok) {
      succeeded.push(id);
    } else {
      failed.push({ id, reason: httpFailureReason(res) });
    }
  }
  let status: RelationshipsTransitionResult['status'];
  if (ids.length === 0) {
    status = 'noop';
  } else if (failed.length === 0) {
    status = 'done';
  } else if (succeeded.length === 0) {
    status = 'failed';
  } else {
    status = 'partial';
  }
  return {
    command: 'relationships reset',
    status,
    targetState: 'suggested',
    succeeded,
    failed,
    // `reset` has no `--all`, so an empty call can only be a usage error.
    noopKind: ids.length === 0 ? 'no-ids-given' : undefined,
    reason: ids.length === 0 ? 'no rule ids given' : undefined,
  };
}

export async function runRelationshipsReset(ids: string[]): Promise<void> {
  const client = new OpenRoadieHttpClient(loadConfig());
  const spinner = ora('Returning rules to review…').start();
  const result = await resetRules(client, ids);
  const failLines = result.failed.map(f => `  failed ${f.id}: ${f.reason}`);
  if (result.status === 'failed') {
    spinner.fail('Could not reset rules');
    // All-failed. Each id has its own reason (e.g. "expected 'inactive'"), so
    // printing only the top-level `reason` — undefined when every id failed —
    // dropped every cause. Render them, as the partial branch below does; keep
    // `reason` for a transport error, which carries no per-id `failed[]`.
    printFailure(
      [`Failed to reset rules: ${result.reason ?? ''}`.trim(), ...failLines],
      result,
    );
    return;
  }
  if (result.status === 'noop') {
    spinner.warn('Nothing to do');
    printResult(
      [`${result.reason ?? 'Nothing to do.'} — pass rule ids to reset.`],
      result,
      transitionExitCode(result),
    );
    return;
  }
  if (result.failed.length > 0) {
    spinner.warn(
      `${result.succeeded.length} rule(s) → suggested; ${result.failed.length} failed`,
    );
  } else {
    spinner.succeed(`${result.succeeded.length} rule(s) → suggested`);
  }
  printResult(
    [
      `${result.succeeded.length} rule(s) returned to review; ${result.failed.length} failed.`,
      ...failLines,
    ],
    result,
    transitionExitCode(result),
  );
}

async function runTransition(
  action: 'approve' | 'reject',
  ids: string[],
  opts: { all?: boolean },
): Promise<void> {
  const config = loadConfig();
  const client = new OpenRoadieHttpClient(config);
  const label = action === 'approve' ? 'Approving' : 'Rejecting';
  const spinner = ora(`${label} relationship rules…`).start();
  const result =
    action === 'approve'
      ? await approveRules(client, ids, opts)
      : await rejectRules(client, ids, opts);

  const failLines = result.failed.map(
    fail => `  failed ${fail.id}: ${fail.reason}`,
  );
  const inverseNote =
    result.dismissedAsInverse && result.dismissedAsInverse.length > 0
      ? ` (${result.dismissedAsInverse.length} mirrored suggestion(s) dismissed so the edge is not duplicated)`
      : '';
  // A mirror nobody requested that could not be suppressed: still `suggested`,
  // so it needs a manual reject — but it is not a failure of this request, and
  // it must not read as one or be counted with `failed`.
  const stranded = result.inverseDismissFailed ?? [];
  const strandedLines =
    stranded.length === 0
      ? []
      : [
          `${stranded.length} mirrored suggestion(s) could not be dismissed and remain suggested (not approve failures) — dismiss by hand:`,
          ...stranded.map(m => `  mirror ${m.id}: ${m.reason}`),
          `  openroadie relationships reject --ids ${stranded.map(m => m.id).join(',')}`,
        ];

  if (result.status === 'failed') {
    spinner.fail(`Could not ${action} rules`);
    // All-failed. For the bulk approve path this is a 200 with every requested
    // id in `failed` and no top-level `reason`, so printing only `reason` hid
    // every per-id cause — the worse outcome showing less than `partial` does.
    // Render the same per-id failures (and stranded mirrors) the partial branch
    // does; keep `reason` for transport/parse errors, which carry no `failed[]`.
    printFailure(
      [
        `Failed to ${action} rules: ${result.reason ?? ''}`.trim(),
        ...failLines,
        ...strandedLines,
      ],
      result,
    );
    return;
  }
  if (result.status === 'noop') {
    spinner.warn('Nothing to do');
    printResult(
      [
        result.noopKind === 'no-ids-given'
          ? `${result.reason ?? 'Nothing to do.'} — pass rule ids, or --all.`
          : (result.reason ?? 'Nothing to do.'),
      ],
      result,
      transitionExitCode(result),
    );
    return;
  }

  // Some succeeded, some failed → partial. Warn (not succeed), list the
  // failures, and exit non-zero: an id the caller named did not transition, so
  // a `&&` chain must not run on as if the batch had landed.
  if (result.status === 'partial') {
    spinner.warn(
      `${result.succeeded.length} rule(s) → ${result.targetState}${inverseNote}; ${result.failed.length} failed`,
    );
    printResult(
      [
        `${result.succeeded.length} rule(s) → ${result.targetState}${inverseNote}; ${result.failed.length} could not be ${action === 'approve' ? 'approved' : 'rejected'}:`,
        ...failLines,
        ...strandedLines,
      ],
      result,
      transitionExitCode(result),
    );
    return;
  }

  spinner.succeed(
    `${action === 'approve' ? 'Approved' : 'Rejected'} ${result.succeeded.length} rule(s)${inverseNote}`,
  );
  printResult(
    [
      `${result.succeeded.length} rule(s) → ${result.targetState}; ${result.failed.length} failed.${inverseNote}`,
      ...failLines,
      ...strandedLines,
    ],
    result,
    transitionExitCode(result),
  );
}

export async function runRelationshipsApprove(
  ids: string[],
  opts: { all?: boolean },
): Promise<void> {
  await runTransition('approve', ids, opts);
}

export async function runRelationshipsReject(
  ids: string[],
  opts: { all?: boolean },
): Promise<void> {
  await runTransition('reject', ids, opts);
}

export type MatchStrategy =
  | 'exact'
  | 'contains'
  | 'array_contains'
  | 'regex'
  | 'person_name_alias';

/**
 * Direct FIELD-MATCHING rule authoring — the CLI twin of the MCP
 * `manage_relationship_rule_create` tool. Both POST the identical body to the same
 * backend route (`/api/catalog-datastore/relationship-rules`); the backend is
 * the single source of truth, CLI and MCP are just two clients of it. Unlike
 * `suggest` (auto-discovery → triage the noise), this authors one precise rule
 * from explicit field expressions. Still field-matching only — see the scope
 * gate at the top of this file; integration-backed stays unbuilt (epic 33699).
 */
export interface IntegrationBackedConfig {
  integrationId: string;
  method?: string;
  path: string;
  pathExpression?: string;
  sourceContext?: {
    maxDepth?: number;
    relationshipTypes?: string[];
    datasourceIds?: string[];
  };
  responseMatchExpression: string;
  metadataExpression?: string;
}

export interface CreateRuleInput {
  name: string;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceFieldExpression: string;
  targetFieldExpression: string;
  relationshipType: string;
  description?: string;
  reciprocalRelationshipType?: string;
  matchStrategy?: MatchStrategy;
  sourceFilterExpression?: string;
  targetFilterExpression?: string;
  strategy?: 'field-matching' | 'integration-backed';
  integrationConfig?: IntegrationBackedConfig;
  state?: 'suggested' | 'active';
}

export interface CreateRuleResult {
  command: 'relationships create';
  status: 'created' | 'failed';
  rule?: {
    id: string;
    name?: string;
    state?: string;
    relationshipType?: string;
  };
  reason?: string;
}

function hasStringProperty(
  value: unknown,
  property: keyof IntegrationBackedConfig,
): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)[property] === 'string' &&
    ((value as Record<string, unknown>)[property] as string).trim() !== ''
  );
}

function validateCreateRuleInput(input: CreateRuleInput): string | undefined {
  const strategy = input.strategy ?? 'field-matching';
  if (strategy === 'field-matching' && input.integrationConfig) {
    return 'field-matching rules cannot include --integration-config';
  }
  if (strategy !== 'integration-backed') {
    return undefined;
  }
  if (!input.integrationConfig) {
    return 'integration-backed rules require --integration-config';
  }
  const missing = (
    ['integrationId', 'path', 'responseMatchExpression'] as const
  ).filter(property => !hasStringProperty(input.integrationConfig, property));
  return missing.length > 0
    ? `integration-backed --integration-config missing required field(s): ${missing.join(
        ', ',
      )}`
    : undefined;
}

export async function createRule(
  client: OpenRoadieHttpClient,
  input: CreateRuleInput,
): Promise<CreateRuleResult> {
  const validationError = validateCreateRuleInput(input);
  if (validationError) {
    return {
      command: 'relationships create',
      status: 'failed',
      reason: validationError,
    };
  }

  const body = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  const res = await client.post<{
    id: string;
    name?: string;
    state?: string;
    relationshipType?: string;
  }>(ENDPOINTS.relationshipRules, body);

  if (!res.ok || !res.body?.id) {
    return {
      command: 'relationships create',
      status: 'failed',
      reason: httpFailureReason(res),
    };
  }
  return { command: 'relationships create', status: 'created', rule: res.body };
}

export async function runRelationshipsCreate(
  input: CreateRuleInput,
): Promise<void> {
  const client = new OpenRoadieHttpClient(loadConfig());
  const spinner = ora('Creating relationship rule…').start();
  const result = await createRule(client, input);

  if (result.status === 'failed') {
    spinner.fail('Could not create rule');
    printFailure(
      [`Failed to create rule: ${result.reason ?? ''}`.trim()],
      result,
    );
    return;
  }

  spinner.succeed(`Created rule "${result.rule?.name}"`);
  printResult(
    [
      `Rule ${result.rule?.id} (${result.rule?.state}) — ${result.rule?.relationshipType}.`,
    ],
    result,
  );
}

export interface ReviewResult {
  command: 'review';
  status: 'ok' | 'failed';
  pending: Array<{ id: string; name?: string; relationshipType?: string }>;
  needsReview: boolean;
  reason?: string;
}

/**
 * Drive the review screen from `GET .../relationship-rules?state=suggested`.
 * Every still-suggested rule is a pending decision; `needsReview` is true while
 * any remain, so the caller knows to prompt the human before approving them.
 */
export async function reviewSuggested(
  client: OpenRoadieHttpClient,
): Promise<ReviewResult> {
  const res = await client.get<RulesListResponse>(
    `${ENDPOINTS.relationshipRules}?state=suggested&limit=${RULE_PAGE}`,
  );
  if (!res.ok) {
    return {
      command: 'review',
      status: 'failed',
      pending: [],
      needsReview: false,
      reason: res.unreachable
        ? 'backend unreachable'
        : `request failed (status ${res.status})`,
    };
  }
  const pending = (res.body?.items ?? []).map(rule => ({
    id: rule.id,
    name: rule.name,
    relationshipType: rule.relationshipType,
  }));
  return {
    command: 'review',
    status: 'ok',
    pending,
    needsReview: pending.length > 0,
  };
}

export async function runReview(): Promise<void> {
  const config = loadConfig();
  const client = new OpenRoadieHttpClient(config);
  const spinner = ora('Loading suggested relationship rules…').start();
  const result = await reviewSuggested(client);

  if (result.status === 'failed') {
    spinner.fail('Could not load review');
    printFailure([`Failed to load review: ${result.reason}`], result);
    return;
  }

  spinner.stop();

  if (result.pending.length === 0) {
    printResult(['No suggested relationship rules pending review.'], result);
    return;
  }

  // `review` is the HUMAN path: relationship correctness is a judgement call, so
  // a person reviews the rules in the OpenRoadie web app (confidence + sample
  // matches per rule) and approves/rejects them there — not in a CLI screen. (An
  // agent driving the install does NOT use this command; it triages the rules
  // from the API and acts with `relationships approve/reject`.)
  const reviewUrl = `${config.backendUrl.replace(/\/+$/, '')}/relationships/suggestions`;
  const open = openUrl(reviewUrl);
  printResult(
    [
      `${result.pending.length} relationship rule(s) await your review.`,
      open.opened
        ? `Opened your browser to review and approve/reject them: ${reviewUrl}`
        : `Review and approve/reject them in the OpenRoadie app: ${reviewUrl}`,
    ],
    { ...result, reviewUrl, opened: open.opened },
  );
}

export async function runGraph(): Promise<void> {
  const config = loadConfig();
  const graphUrl = `${config.backendUrl.replace(/\/+$/, '')}/relationships`;
  const open = openUrl(graphUrl);
  printResult(
    [
      open.opened
        ? `Opened the relationships graph: ${graphUrl}`
        : `Open the relationships graph: ${graphUrl}`,
    ],
    { command: 'graph', status: 'ok', graphUrl, opened: open.opened },
  );
}
