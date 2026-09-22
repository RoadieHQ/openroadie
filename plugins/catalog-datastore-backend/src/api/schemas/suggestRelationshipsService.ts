import type {
  RelationshipRule,
  RelationshipSuggestionGateEvidence,
  RelationshipSuggestionValueType,
} from '@roadiehq/catalog-datastore-common';
import { ObjectDao, RelationshipRuleDao } from '../../database';
import {
  buildFieldMatchSuggestions,
  type CandidateMatch,
  FieldMatch,
  type FieldProfile,
  type FieldProfileSet,
} from './stringFieldAnalysis';
import {
  classifyValueType,
  extractStringValues,
  toFieldStats,
} from './field-profiling';
import {
  SuggestionCorpusCache,
  type SuggestionCorpus,
} from './suggestionCorpus';
import {
  classifyRelationshipCandidateValue,
  expandPersonNameSearchAliases,
} from './relationshipCandidateFilter';
import { fuzzySimilarity } from './fuzzyComparison';
import {
  applyCandidateGates,
  KEYNESS_GATE_THRESHOLD,
  TINY_ENUM_MAX_DISTINCT,
  TINY_ENUM_TOP_SHARE,
  TRIVIAL_DOMAIN_MIN_DISTINCT,
  type GateContext,
  type GateEvidence,
  type GateFailureReason,
  type GateRescueHint,
} from './candidateGates';
import {
  fsScoreCandidate,
  type FsScore,
  type SignalContext,
} from './signalScoring';
import {
  IDENTITY_CALIBRATION,
  type ScoreCalibration,
} from './scoreCalibration';
import { measureU } from './uEstimation';
import { buildTokenIdf } from './nameSimilarity';
import { semanticCompatibility } from './semanticFieldClassification';
import { dominantValueType } from '../_shared';
import {
  synthesizeCompositeKey,
  synthesizeTransform,
  type TransformProgram,
} from './transformSynthesis';
import {
  enumerateFilterRefinements,
  type FilterRefinementResult,
} from './filteredRuleRefinement';
import {
  resolveSuggestions,
  PAIR_PERSIST_CAP,
  type ResolveSuppressionReason,
} from './resolveSuggestions';

interface SearchResultItem {
  val: string;
  datasourceId: string;
  objectId: string;
  object: unknown;
  targetVal?: string;
  fuzzyScore?: number;
  containsMatch?: boolean;
}

export interface SuggestionResult {
  datasourceId: string;
  total: number;
  candidateValueCount: number;
  searchResultCount: number;
  suggestions: FieldMatch[];
  suppressedSuggestions: FieldMatch[];
}

function collectTargetAliasSearchResults(params: {
  sourceValues: Set<string>;
  targetSamples: Array<{
    targetDatasourceId: string;
    sample: Awaited<ReturnType<ObjectDao['sampleForSuggestions']>>;
  }>;
}): SearchResultItem[] {
  const results: SearchResultItem[] = [];

  const visit = (
    value: unknown,
    targetDatasourceId: string,
    objectId: string,
    object: unknown,
  ): void => {
    if (typeof value === 'string') {
      for (const alias of expandPersonNameSearchAliases(value)) {
        if (params.sourceValues.has(alias)) {
          results.push({
            val: alias,
            datasourceId: targetDatasourceId,
            objectId,
            object,
          });
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, targetDatasourceId, objectId, object);
      }
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const child of Object.values(value as Record<string, unknown>)) {
        visit(child, targetDatasourceId, objectId, object);
      }
    }
  };

  for (const { targetDatasourceId, sample } of params.targetSamples) {
    for (const item of sample.items) {
      visit(item.object, targetDatasourceId, item.objectId, item.object);
    }
  }

  return results;
}

/**
 * Corpus-only exact discovery: every string value in a target sample that
 * literally equals a source candidate value. Replaces the whole-DB ILIKE
 * pass — per-pair and un-truncated, so no value starvation under a shared
 * LIMIT. The gates' staged containment verification only partially restores
 * recall for large targets: it rescues referenced tables up to roughly 2x
 * SUGGESTION_SAMPLE_LIMIT (the VERIFICATION_CONTAINMENT_FLOOR in
 * candidateGates.ts skips candidates below a 0.5 raw-containment floor as
 * hopeless), and VERIFICATION_VALUE_CAP bounds how much of the remaining gap
 * can be rescued even above that floor.
 */
function collectExactSearchResults(params: {
  sourceValues: Set<string>;
  targetSamples: Array<{
    targetDatasourceId: string;
    sample: Awaited<ReturnType<ObjectDao['sampleForSuggestions']>>;
  }>;
}): SearchResultItem[] {
  const results: SearchResultItem[] = [];

  const visit = (
    value: unknown,
    targetDatasourceId: string,
    objectId: string,
    object: unknown,
  ): void => {
    if (typeof value === 'string') {
      if (params.sourceValues.has(value)) {
        results.push({
          val: value,
          datasourceId: targetDatasourceId,
          objectId,
          object,
        });
      }
      return;
    }
    // Mirrors extractFieldValues: integer leaves are canonicalized to their
    // string form so a raw-number target (e.g. `{ id: 42 }`) can still match
    // a source value profiled as `'42'`. Non-integers are measures, skipped.
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        const canonical = String(value);
        if (params.sourceValues.has(canonical)) {
          results.push({
            val: canonical,
            datasourceId: targetDatasourceId,
            objectId,
            object,
          });
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, targetDatasourceId, objectId, object);
      }
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const child of Object.values(value as Record<string, unknown>)) {
        visit(child, targetDatasourceId, objectId, object);
      }
    }
  };

  for (const { targetDatasourceId, sample } of params.targetSamples) {
    for (const item of sample.items) {
      visit(item.object, targetDatasourceId, item.objectId, item.object);
    }
  }

  return results;
}

function dedupeSearchResults(results: SearchResultItem[]): SearchResultItem[] {
  const seen = new Set<string>();
  return results.filter(result => {
    const targetKey = result.targetVal ?? result.val;
    const key = `${result.val}|${result.datasourceId}|${result.objectId}|${targetKey}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Walks each sampled target object collecting string values, classifies them,
 * and pairs them with same-typed source values via Jaro-Winkler / token-set
 * similarity. Emits one SearchResultItem per (sourceValue, targetValue,
 * targetObject) tuple where the values are not exact-equal but cross the
 * type-specific similarity threshold defined in `fuzzyComparison.ts`.
 *
 * Only `person_name`, `handle`, and `slug` participate. UUIDs, emails, and
 * URLs are intentionally excluded — single-character differences in those
 * types almost always indicate distinct identifiers, not typos.
 */
function collectFuzzySearchResults(params: {
  sourceValues: Set<string>;
  exactSourceValuesByType: Map<string, Set<string>>;
  targetSamples: Array<{
    targetDatasourceId: string;
    sample: Awaited<ReturnType<ObjectDao['sampleForSuggestions']>>;
  }>;
}): SearchResultItem[] {
  const results: SearchResultItem[] = [];

  const visit = (
    value: unknown,
    targetDatasourceId: string,
    objectId: string,
    object: unknown,
  ): void => {
    if (typeof value === 'string') {
      const targetType = classifyRelationshipCandidateValue(value);
      if (
        targetType !== 'person_name' &&
        targetType !== 'handle' &&
        targetType !== 'slug'
      ) {
        return;
      }
      const candidatesOfType =
        params.exactSourceValuesByType.get(targetType) ?? new Set<string>();
      for (const sourceVal of candidatesOfType) {
        if (sourceVal === value || params.sourceValues.has(value)) {
          continue;
        }
        const score = fuzzySimilarity(sourceVal, value, targetType);
        if (score === null) {
          continue;
        }
        results.push({
          val: sourceVal,
          datasourceId: targetDatasourceId,
          objectId,
          object,
          targetVal: value,
          fuzzyScore: score,
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, targetDatasourceId, objectId, object);
      }
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const child of Object.values(value as Record<string, unknown>)) {
        visit(child, targetDatasourceId, objectId, object);
      }
    }
  };

  for (const { targetDatasourceId, sample } of params.targetSamples) {
    for (const item of sample.items) {
      visit(item.object, targetDatasourceId, item.objectId, item.object);
    }
  }

  return results;
}

/**
 * Walks each sampled target object collecting string values, and emits a
 * SearchResultItem when a source value is a strict prefix of the target value
 * (followed by a delimiter — typically `-`, `_`, `.`, `/`, or `:`). Bridges
 * naming conventions like Kubernetes pod names (`<deployment>-<rs>-<rand>`)
 * back to deployments without requiring `exact` equality. Tagged with
 * `containsMatch: true` so the analyzer recognises this as evidence for a
 * `matchStrategy: 'contains'` rule rather than a fuzzy approximation.
 *
 * Only `handle` and `slug` types participate, and source values must be at
 * least 6 characters to avoid promiscuous prefixes ("api" inside everything).
 */
function collectPrefixContainsResults(params: {
  sourceValues: Set<string>;
  exactSourceValuesByType: Map<string, Set<string>>;
  targetSamples: Array<{
    targetDatasourceId: string;
    sample: Awaited<ReturnType<ObjectDao['sampleForSuggestions']>>;
  }>;
}): SearchResultItem[] {
  const minSourceLength = 6;
  const results: SearchResultItem[] = [];

  const eligibleSources = new Set<string>();
  for (const t of ['handle', 'slug']) {
    for (const v of params.exactSourceValuesByType.get(t) ?? []) {
      if (v.length >= minSourceLength) {
        eligibleSources.add(v);
      }
    }
  }
  if (eligibleSources.size === 0) {
    return results;
  }

  const isDelim = (c: string): boolean =>
    c === '-' || c === '_' || c === '.' || c === '/' || c === ':';

  const visit = (
    value: unknown,
    targetDatasourceId: string,
    objectId: string,
    object: unknown,
  ): void => {
    if (typeof value === 'string') {
      const targetType = classifyRelationshipCandidateValue(value);
      if (targetType !== 'handle' && targetType !== 'slug') {
        return;
      }
      // Skip exact matches (handled by the literal search pass already).
      if (params.sourceValues.has(value)) {
        return;
      }
      if (value.length < minSourceLength + 2) {
        return;
      }
      for (const sourceVal of eligibleSources) {
        if (sourceVal === value) {
          continue;
        }
        if (
          value.length > sourceVal.length &&
          value.startsWith(sourceVal) &&
          isDelim(value.charAt(sourceVal.length))
        ) {
          results.push({
            val: sourceVal,
            datasourceId: targetDatasourceId,
            objectId,
            object,
            targetVal: value,
            containsMatch: true,
          });
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, targetDatasourceId, objectId, object);
      }
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const child of Object.values(value as Record<string, unknown>)) {
        visit(child, targetDatasourceId, objectId, object);
      }
    }
  };

  for (const { targetDatasourceId, sample } of params.targetSamples) {
    for (const item of sample.items) {
      visit(item.object, targetDatasourceId, item.objectId, item.object);
    }
  }
  return results;
}

function partitionSourceValuesByType(
  values: Iterable<string>,
): Map<string, Set<string>> {
  const byType = new Map<string, Set<string>>();
  for (const value of values) {
    const type = classifyRelationshipCandidateValue(value);
    if (type === null) {
      continue;
    }
    let bucket = byType.get(type);
    if (!bucket) {
      bucket = new Set();
      byType.set(type, bucket);
    }
    bucket.add(value);
  }
  return byType;
}

/**
 * Folds gate evidence into a suggestion's evidenceSummary. A failed gate
 * reports only the fields the failing check itself computed (see GateResult
 * in candidateGates.ts) — e.g. `referenced-not-key-like` measures only
 * `referencedCardinalityRatio`, never containment. Copying just the present
 * fields (no `?? 0` / `?? false` defaulting) keeps the wire data honest:
 * an absent field means "not measured", not "measured as zero/false".
 */
function withGateEvidence(
  suggestion: FieldMatch,
  evidence: Partial<GateEvidence>,
  rescueHint?: GateRescueHint,
): FieldMatch {
  const gate: RelationshipSuggestionGateEvidence = {
    ...(evidence.containment !== undefined
      ? { containment: evidence.containment }
      : {}),
    ...(evidence.containmentDirection !== undefined
      ? { containmentDirection: evidence.containmentDirection }
      : {}),
    ...(evidence.containmentVerified !== undefined
      ? { containmentVerified: evidence.containmentVerified }
      : {}),
    ...(evidence.referencedCardinalityRatio !== undefined
      ? { referencedCardinalityRatio: evidence.referencedCardinalityRatio }
      : {}),
    ...(rescueHint ? { rescueHint } : {}),
  };
  return {
    ...suggestion,
    evidenceSummary: {
      ...suggestion.evidenceSummary,
      gate,
    },
  };
}

/**
 * Resolves the FieldProfile the gate should see for each side of a
 * suggestion. `buildFieldMatchSuggestions` reverses array_contains
 * candidates (source array field, target scalar field) so the suggestion
 * reads scalar-references-array: for those, `suggestion.sourceField` is a
 * field of `suggestion.sourceDatasourceId` (one of this run's *target*
 * datasources), and `suggestion.targetField` is a field of the run's own
 * source datasource — the mirror image of the non-reversed case. Detect the
 * flip from `sourceDatasourceId` disagreeing with the run's source id and
 * swap which profile map each side is resolved from; the reversal never
 * changes `targetDatasourceId` (it's always where the "target" profile
 * lives), so gate-context lookups keyed on it need no swapping.
 */
function resolveGateProfiles(
  suggestion: CandidateMatch,
  params: {
    datasourceId: string;
    sourceProfiles: FieldProfileSet;
    targetProfilesByDatasource?: Record<string, Record<string, FieldProfile>>;
  },
): { sourceProfile?: FieldProfile; targetProfile?: FieldProfile } {
  const isReversedArrayContains =
    suggestion.sourceDatasourceId !== undefined &&
    suggestion.sourceDatasourceId !== params.datasourceId;
  if (isReversedArrayContains) {
    return {
      sourceProfile: (params.targetProfilesByDatasource ?? {})[
        `${suggestion.sourceDatasourceId}`
      ]?.[`${suggestion.sourceField}`],
      targetProfile:
        params.sourceProfiles.profilesByField[`${suggestion.targetField}`],
    };
  }
  return {
    sourceProfile:
      params.sourceProfiles.profilesByField[`${suggestion.sourceField}`],
    targetProfile: (params.targetProfilesByDatasource ?? {})[
      `${suggestion.targetDatasourceId}`
    ]?.[`${suggestion.targetField}`],
  };
}

/**
 * The evidence fields every FieldMatch carries regardless of whether it
 * survived scoring — literal per-field semantics, independent of which side
 * fsScoreCandidate treats as dependent/referenced (see buildSignalContext).
 */
interface BaseEvidenceFields {
  valueTypes: CandidateMatch['valueTypes'];
  distinctMatchedValueCount: number;
  sourceFieldStats: ReturnType<typeof toFieldStats>;
  targetFieldStats: ReturnType<typeof toFieldStats>;
  sourceFieldSemantic: CandidateMatch['sourceFieldSemantic'];
  targetFieldSemantic: CandidateMatch['targetFieldSemantic'];
  semanticCompatibility: ReturnType<typeof semanticCompatibility>;
  topMatchedValues: string[];
}

/**
 * Strips the raw-evidence-only keys `CandidateMatch` carries that aren't part
 * of the wire `FieldMatch` shape (`valueCounts` — a `Map`, which
 * `JSON.stringify`s to `{}` and would silently lie on the wire — plus
 * `valueTypes`/`distinctMatchedValueCount`/`fuzzyMatchCount`/
 * `sourceFieldSemantic`/`targetFieldSemantic`/`topMatchedValues`, which live
 * inside `evidenceSummary` instead). What's left is exactly
 * `Omit<FieldMatch, 'score' | 'confidenceBand' | 'suppressionReason' |
 * 'evidenceSummary'>` — safe to spread into a `FieldMatch` literal.
 */
function candidateBaseFields(
  candidate: CandidateMatch,
): Omit<
  CandidateMatch,
  | 'valueCounts'
  | 'valueTypes'
  | 'distinctMatchedValueCount'
  | 'fuzzyMatchCount'
  | 'sourceFieldSemantic'
  | 'targetFieldSemantic'
  | 'topMatchedValues'
> {
  const {
    valueCounts: _valueCounts,
    valueTypes: _valueTypes,
    distinctMatchedValueCount: _distinctMatchedValueCount,
    fuzzyMatchCount: _fuzzyMatchCount,
    sourceFieldSemantic: _sourceFieldSemantic,
    targetFieldSemantic: _targetFieldSemantic,
    topMatchedValues: _topMatchedValues,
    ...base
  } = candidate;
  return base;
}

function buildBaseEvidenceSummary(
  candidate: CandidateMatch,
  sourceProfile: FieldProfile | undefined,
  targetProfile: FieldProfile | undefined,
): BaseEvidenceFields {
  return {
    valueTypes: candidate.valueTypes,
    distinctMatchedValueCount: candidate.distinctMatchedValueCount,
    sourceFieldStats: toFieldStats(sourceProfile),
    targetFieldStats: toFieldStats(targetProfile),
    sourceFieldSemantic: candidate.sourceFieldSemantic,
    targetFieldSemantic: candidate.targetFieldSemantic,
    semanticCompatibility: semanticCompatibility(
      candidate.sourceFieldSemantic,
      candidate.targetFieldSemantic,
    ),
    topMatchedValues: candidate.topMatchedValues,
  };
}

/**
 * A gate-suppressed candidate was never FS-scored (candidateGates.ts frozen
 * contract: gates run before scoring), so it gets score 0 / band 'low' / no
 * waterfall, honestly — not a fabricated probability.
 */
function toGateSuppressedFieldMatch(
  candidate: CandidateMatch,
  sourceProfile: FieldProfile | undefined,
  targetProfile: FieldProfile | undefined,
  reason: string,
  evidence: Partial<GateEvidence>,
  rescueHint?: GateRescueHint,
): FieldMatch {
  const base: FieldMatch = {
    ...candidateBaseFields(candidate),
    score: 0,
    confidenceBand: 'low',
    suppressionReason: reason,
    evidenceSummary: {
      ...buildBaseEvidenceSummary(candidate, sourceProfile, targetProfile),
      // Never scored — 0 is the honest filler, not a measured penalty.
      commonValuePenalty: 0,
      explanation: `suppressed by gate: ${reason}`,
    },
  };
  return withGateEvidence(base, evidence, rescueHint);
}

/**
 * Builds the SignalContext for a gate survivor, applying the direction-swap
 * contract documented on SignalContext in signalScoring.ts: when the gate's
 * containmentDirection is 'target-to-source', the candidate's target field is
 * actually the DEPENDENT (foreign-key) side and its source field is the
 * REFERENCED side — so every dependent/referenced-keyed input (profiles,
 * container name, referenced value counts, sample scale) swaps with it.
 * Without this, distribution-agreement, name-similarity, semantic and
 * fan-out would all evaluate reversed for those candidates.
 */
function buildSignalContext(params: {
  candidate: CandidateMatch;
  runDatasourceId: string;
  gateEvidence: GateEvidence;
  sourceProfile: FieldProfile | undefined;
  targetProfile: FieldProfile | undefined;
  idf: Map<string, number>;
  datasourceNamesById?: Record<string, string>;
  sampleScaleByDatasourceId?: Record<string, number>;
}): SignalContext {
  const { candidate, gateEvidence } = params;
  const swapped = gateEvidence.containmentDirection === 'target-to-source';

  const referencedDatasourceId = swapped
    ? (candidate.sourceDatasourceId ?? params.runDatasourceId)
    : candidate.targetDatasourceId;

  return {
    sourceField: swapped ? candidate.targetField : candidate.sourceField,
    targetField: swapped ? candidate.sourceField : candidate.targetField,
    sourceProfile: swapped ? params.targetProfile : params.sourceProfile,
    targetProfile: swapped ? params.sourceProfile : params.targetProfile,
    containment: gateEvidence.containment,
    // Accumulator match evidence — which values matched. These are search hits
    // on the referenced side, so their *counts* are not a dependent frequency;
    // signals that need per-side frequencies read sourceProfile/targetProfile
    // (both swapped above). This supplies the matched value SET, which has no
    // side of its own, so it never swaps.
    matchedValueCounts: candidate.valueCounts,
    referencedValueCounts: (swapped
      ? params.sourceProfile
      : params.targetProfile
    )?.valueCounts,
    idf: params.idf,
    referencedContainerName:
      params.datasourceNamesById?.[`${referencedDatasourceId}`],
    referencedSampleScale:
      params.sampleScaleByDatasourceId?.[`${referencedDatasourceId}`] ?? 1,
  };
}

/**
 * Assembles the FieldMatch for a gate survivor once fsScoreCandidate has run.
 * `commonValuePenalty` is API-compat filler, not a real signal anymore — the
 * waterfall (and its `explanation`) is the actual, honest account of why this
 * scored the way it did.
 */
function assembleScoredFieldMatch(
  candidate: CandidateMatch,
  fsScore: FsScore,
  sourceProfile: FieldProfile | undefined,
  targetProfile: FieldProfile | undefined,
): FieldMatch {
  const rarityEntry = fsScore.waterfall.find(
    entry => entry.signal === 'value-rarity',
  );
  const commonValuePenalty =
    rarityEntry !== undefined && rarityEntry.weight < 0
      ? rarityEntry.weight
      : 0;

  return {
    ...candidateBaseFields(candidate),
    score: fsScore.probability,
    confidenceBand: fsScore.band,
    evidenceSummary: {
      ...buildBaseEvidenceSummary(candidate, sourceProfile, targetProfile),
      commonValuePenalty,
      explanation: fsScore.explanation,
      waterfall: fsScore.waterfall,
    },
  };
}

/** Gate-suppressed candidates entering synthesis, per source-datasource result. */
export const RESCUE_ATTEMPT_CAP = 20;

export interface BuildSuggestionResultParams {
  datasourceId: string;
  total: number;
  sourceProfiles: FieldProfileSet;
  /** The run's own source datasource sample, raw — needed by the filter
   * rescue generator to slice by an enum-sibling field (profiles alone can't
   * re-derive membership). */
  sourceObjects: unknown[];
  searchResults: SearchResultItem[];
  targetProfilesByDatasource?: Record<string, Record<string, FieldProfile>>;
  /** total > sampled items, per target datasource — drives staged verification. */
  targetCorpusPartialByDatasource?: Record<string, boolean>;
  verifyValuesPresent?: (
    targetDatasourceId: string,
    targetField: string,
    values: string[],
  ) => Promise<Set<string>>;
  /** Built once per buildSuggestions call, over every corpus in the run. */
  idf: Map<string, number>;
  /** Measured once per buildSuggestions call, from the source + target corpora. */
  uBySignal: Map<string, number>;
  /** max(1, corpusTotal / sampledCount) per datasource in the run. */
  sampleScaleByDatasourceId?: Record<string, number>;
  datasourceNamesById?: Record<string, string>;
  /** Applied to every candidate's raw log-odds before the sigmoid (Task 4 of
   * stage 7); defaults to IDENTITY_CALIBRATION at buildSuggestions' boundary. */
  calibration: ScoreCalibration;
}

/** Mirrors the `targetCorpusPartial`/`verifyValuesPresent` wiring every gate
 * call needs — the main gate/score loop and the rescue loop both re-gate
 * against the same run-level context, keyed off a candidate's targetDatasourceId. */
function buildGateContext(
  candidate: CandidateMatch,
  params: BuildSuggestionResultParams,
): GateContext {
  return {
    targetCorpusPartial:
      (params.targetCorpusPartialByDatasource ?? {})[
        `${candidate.targetDatasourceId}`
      ] ?? false,
    verifyValuesPresent: params.verifyValuesPresent
      ? valuesToVerify =>
          params.verifyValuesPresent!(
            candidate.targetDatasourceId,
            // Verification is field-scoped: confirm the value is the target
            // *field's* value, not merely present somewhere in the object.
            // targetField is always the referenced side here (verification
            // only runs for source-to-target containment).
            candidate.targetField,
            valuesToVerify,
          )
      : undefined,
  };
}

interface ScoringParams {
  runDatasourceId: string;
  idf: Map<string, number>;
  uBySignal: Map<string, number>;
  datasourceNamesById?: Record<string, string>;
  sampleScaleByDatasourceId?: Record<string, number>;
  calibration: ScoreCalibration;
}

type CandidateOutcome =
  | { kind: 'suggestion'; fieldMatch: FieldMatch }
  | { kind: 'suppressed'; fieldMatch: FieldMatch };

/**
 * FS-scores a gate survivor and buckets it exactly like the main loop does —
 * shared by the main loop and the rescue loop so a rescued candidate is
 * scored under the identical rules as any other survivor (design invariant:
 * "no special thresholds, no band shortcuts").
 * `scoringEvidence` (feeds SignalContext, always a complete GateEvidence) and
 * `wireEvidence` (feeds the wire `evidenceSummary.gate`, may be a narrower
 * Partial<GateEvidence>) are the same object for every ordinary gate survivor,
 * but diverge for a composite rescue — see attemptTransformRescue.
 */
function scoreCandidate(
  candidate: CandidateMatch,
  scoringEvidence: GateEvidence,
  wireEvidence: Partial<GateEvidence>,
  sourceProfile: FieldProfile | undefined,
  targetProfile: FieldProfile | undefined,
  scoring: ScoringParams,
): CandidateOutcome {
  const context = buildSignalContext({
    candidate,
    runDatasourceId: scoring.runDatasourceId,
    gateEvidence: scoringEvidence,
    sourceProfile,
    targetProfile,
    idf: scoring.idf,
    datasourceNamesById: scoring.datasourceNamesById,
    sampleScaleByDatasourceId: scoring.sampleScaleByDatasourceId,
  });
  const fsScore = fsScoreCandidate(
    context,
    scoring.uBySignal,
    scoring.calibration,
  );
  const scored = withGateEvidence(
    assembleScoredFieldMatch(candidate, fsScore, sourceProfile, targetProfile),
    wireEvidence,
  );

  if (fsScore.band === 'low') {
    return {
      kind: 'suppressed',
      fieldMatch: { ...scored, suppressionReason: 'score-below-threshold' },
    };
  }
  return { kind: 'suggestion', fieldMatch: scored };
}

function withRescueEvidence(
  fieldMatch: FieldMatch,
  rescue: {
    kind: 'transform' | 'filter';
    detail: string;
    originalField?: string;
  },
): FieldMatch {
  return {
    ...fieldMatch,
    evidenceSummary: {
      ...fieldMatch.evidenceSummary,
      rescue,
    },
  };
}

/** A reversed array_contains candidate pulls its sourceProfile from the run's
 * *target* profile map (see resolveGateProfiles) rather than the run's own
 * source datasource — the rescue generators need sibling fields / raw
 * objects from the same profile set as the dependent field, so v1 restricts
 * both transform and filter rescue to the common, non-reversed case. */
function isReversedArrayContainsCandidate(
  candidate: CandidateMatch,
  runDatasourceId: string,
): boolean {
  return (
    candidate.sourceDatasourceId !== undefined &&
    candidate.sourceDatasourceId !== runDatasourceId
  );
}

/** `profile.valueCounts` filtered to values the gates would themselves treat
 * as eligible (candidateGates.ts's own `eligibleValues`, unexported — this is
 * the counts-preserving equivalent the synthesis generators need). */
function eligibleValueCounts(
  profile: FieldProfile | undefined,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (!profile) {
    return result;
  }
  for (const [value, count] of Object.entries(profile.valueCounts)) {
    if (classifyRelationshipCandidateValue(value) !== null) {
      result[`${value}`] = count;
    }
  }
  return result;
}

function eligibleValueSet(profile: FieldProfile | undefined): Set<string> {
  return new Set(Object.keys(eligibleValueCounts(profile)));
}

// Plain codepoint comparison, not localeCompare — feeds a tie-break that must
// be stable across ICU versions/environments (mirrors transformSynthesis.ts's
// own codepointCompare, which isn't exported).
function codepointCompare(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Applies a transform program to every eligible dependent value, falling
 * back to the value itself when `apply` misses (returns `undefined`) —
 * exactly what the PERSISTED rule's rendered JSONata does at apply time (a
 * `$substringBefore`/`$substringAfter` over a value lacking the literal
 * passes it through unchanged). `transformSynthesis.ts`'s own
 * `transformedValueCounts` omits those pass-throughs (documented there as
 * "optimistic" — fine for the ACCEPT/REJECT synthesis threshold, since a
 * pass-through by definition can't land in the referenced set), which is
 * exactly why re-gating containment against it directly would over-report:
 * a program that only actually explains 90% of the dependent domain would
 * otherwise look like 100% control containment. This is the honest
 * superset synthesis's own result is built from.
 */
export function applyWithPassthrough(
  program: TransformProgram,
  dependentValueCounts: Record<string, number>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [value, count] of Object.entries(dependentValueCounts)) {
    // Mirror the rendered JSONata EXACTLY for the pass-through case. When the
    // base transform doesn't fire (`apply` returns undefined — a strip whose
    // literal is absent), the persisted `$substringBefore`/`$substringAfter`
    // passes the whole value through; if the program also renders an outer
    // `$lowercase` (`foldsResult`), that pass-through is lowercased too. Using
    // the raw value here for a folded program would record an un-lowercased
    // form the deployed rule never produces, over-reporting re-gate matches.
    const passthrough = program.foldsResult ? value.toLowerCase() : value;
    const transformed = program.apply(value) ?? passthrough;
    result[`${transformed}`] = (result[`${transformed}`] ?? 0) + count;
  }
  return result;
}

/** The subset of `dependentValueCounts` whose value is present in
 * `referencedValueSet` — i.e. actual matches, not the full rescued domain
 * (which includes pass-through/non-matching values a FieldProfile must
 * still carry). Feeds a rescued candidate's match evidence (matchCount,
 * sampleValues, topMatchedValues, distinctMatchedValueCount, and
 * SignalContext's matchedValueCounts) so it describes the values the rule
 * will actually resolve, not the pre-rescue ones. */
export function matchedValueCountsOf(
  dependentValueCounts: Record<string, number>,
  referencedValueSet: Set<string>,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [value, count] of Object.entries(dependentValueCounts)) {
    if (referencedValueSet.has(value)) {
      result.set(value, count);
    }
  }
  return result;
}

/**
 * Rebuilds the match-evidence fields a rescued candidate carries — the raw
 * `valueCounts` SignalContext scores from (value-rarity/fan-out), plus the
 * wire-visible `matchCount`/`sampleValues`/`topMatchedValues`/
 * `distinctMatchedValueCount` — over the RESCUED values, not the pre-rescue
 * ones. Without this a rescued suggestion's evidence (and review UI) would
 * still show e.g. "queue-service-backstage" for a rule that actually
 * resolves "queue-service". Mirrors field-match-builder.ts's own
 * count-desc/lexical tie-break for `topMatchedValues`.
 */
function rebuildMatchEvidence(
  candidate: CandidateMatch,
  matchedValueCounts: Map<string, number>,
): CandidateMatch {
  const sorted = [...matchedValueCounts.entries()].sort(
    (a, b) => b[1] - a[1] || codepointCompare(a[0], b[0]),
  );
  const matchCount = sorted.reduce((sum, [, count]) => sum + count, 0);
  return {
    ...candidate,
    valueCounts: matchedValueCounts,
    distinctMatchedValueCount: matchedValueCounts.size,
    topMatchedValues: sorted.slice(0, 5).map(([value]) => value),
    matchCount,
    sampleValues: sorted.slice(0, 5).map(([value]) => value),
  };
}

/**
 * Builds the FieldProfile a re-gate/re-score needs for a transform-rescued
 * dependent field, over its transformed value distribution. Approximations
 * (all documented, all favor honesty over a fabricated perfect score):
 *  - `rowCoverage` is fixed at 1: this is now true, not a fudge — a plain
 *    transform's caller passes `applyWithPassthrough`'s output here, which
 *    (unlike `transformSynthesis.ts`'s own `transformedValueCounts`) already
 *    covers every eligible dependent value, transformed or passed through
 *    unchanged, so nothing is missing from the distribution. A composite
 *    rescue still passes the matched-referenced intersection (no honest
 *    per-value pass-through concept applies there), so `rowCoverage: 1` is
 *    the same fixed value but remains an approximation for that path —
 *    acceptable since a composite's containment is never re-gated at all
 *    (see `gateCompositeRescue`).
 *  - `valueContainer` is fixed at 'scalar': every transform program renders a
 *    single-value JSONata expression.
 *  - `rowCount` is passed in unchanged from the real (pre-transform) profile —
 *    a fact about the corpus, not something the transform affects.
 *  - `looksEnumLike`/`isIdentifierLike`/`dominantValueType` are recomputed with
 *    the exact same formulas field-profiling.ts uses for a real profile, just
 *    over the transformed distribution instead of the raw one.
 */
function buildSyntheticSourceProfile(
  field: string,
  valueCounts: Record<string, number>,
  rowCount: number,
): FieldProfile {
  const distinctCount = Object.keys(valueCounts).length;
  const rowsWithAnyValue = Object.values(valueCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const cardinalityRatio =
    rowsWithAnyValue === 0 ? 0 : distinctCount / rowsWithAnyValue;
  const rowCoverage = 1;

  const valueTypeCounts = new Map<RelationshipSuggestionValueType, number>();
  for (const [value, count] of Object.entries(valueCounts)) {
    const type = classifyValueType(value);
    valueTypeCounts.set(type, (valueTypeCounts.get(type) ?? 0) + count);
  }
  const dominantType = dominantValueType(valueTypeCounts);

  const topValueCount = Object.values(valueCounts).reduce(
    (max, count) => Math.max(max, count),
    0,
  );
  const topValueShare =
    rowsWithAnyValue === 0 ? 0 : topValueCount / rowsWithAnyValue;
  const looksEnumLike =
    rowCoverage >= 0.4 &&
    cardinalityRatio <= 0.6 &&
    topValueShare >= 0.5 &&
    distinctCount <= Math.max(12, Math.ceil(rowCount * 0.5));
  const identityKindTypes: RelationshipSuggestionValueType[] = [
    'uuid',
    'email',
    'handle',
    'slug',
    'numeric_id',
  ];
  const isIdentifierLike =
    identityKindTypes.includes(dominantType) &&
    cardinalityRatio >= 0.5 &&
    rowCoverage >= 0.2 &&
    !looksEnumLike;

  return {
    field,
    rowCount,
    distinctCount,
    rowCoverage,
    cardinalityRatio,
    looksEnumLike,
    isIdentifierLike,
    dominantValueType: dominantType,
    valueContainer: 'scalar',
    valueTypeDistribution: Object.fromEntries(valueTypeCounts),
    valueCounts,
  };
}

/**
 * A composite candidate's `transformedValueCounts` IS the matched-referenced
 * intersection (see transformSynthesis.ts's doc comment on
 * `synthesizeCompositeKey`) — re-running the standard containment gate
 * against it would trivially show ~1.0 containment by construction, not a
 * genuine measurement. So a composite rescue skips the containment gate
 * entirely and instead runs only the two checks that ARE honest here:
 * trivial-domain on the composite's own joined-value profile, and key-ness
 * on the referenced (target) profile, unchanged. Mirrors candidateGates.ts's
 * checkTrivialDomain/checkKeyness using its exported thresholds — those
 * functions themselves aren't exported (candidateGates.ts is frozen).
 */
function gateCompositeRescue(
  compositeProfile: FieldProfile,
  targetProfile: FieldProfile | undefined,
): { passed: true; evidence: Partial<GateEvidence> } | { passed: false } {
  const eligible = eligibleValueSet(compositeProfile);
  if (eligible.size < TRIVIAL_DOMAIN_MIN_DISTINCT) {
    return { passed: false };
  }
  if (eligible.size <= TINY_ENUM_MAX_DISTINCT) {
    const counts = Object.values(compositeProfile.valueCounts);
    const total = counts.reduce((sum, count) => sum + count, 0);
    const maxCount = counts.reduce((max, count) => Math.max(max, count), 0);
    const topShare = total === 0 ? 0 : maxCount / total;
    if (topShare >= TINY_ENUM_TOP_SHARE) {
      return { passed: false };
    }
  }

  const referencedCardinalityRatio = targetProfile?.cardinalityRatio ?? 0;
  if (referencedCardinalityRatio < KEYNESS_GATE_THRESHOLD) {
    return { passed: false };
  }
  return {
    passed: true,
    evidence: {
      referencedCardinalityRatio,
      dependentDistinctCount: eligible.size,
    },
  };
}

/** Eligible value counts for every field in the run's own source profile set,
 * keyed by (standalone JSONata) field path — the sibling-field input
 * `synthesizeCompositeKey` needs. The original candidate's own field is a
 * valid composite member (e.g. repo & ':' & tag, where 'repo' was the
 * original failed candidate), so it's deliberately not excluded. */
function buildFieldValueCountsForComposite(
  sourceProfiles: FieldProfileSet,
): Record<string, Record<string, number>> {
  const result: Record<string, Record<string, number>> = {};
  for (const [field, profile] of Object.entries(
    sourceProfiles.profilesByField,
  )) {
    const counts = eligibleValueCounts(profile);
    if (Object.keys(counts).length > 0) {
      result[`${field}`] = counts;
    }
  }
  return result;
}

/** Per source object, field path -> the value(s) it holds — the co-occurrence
 * evidence `synthesizeCompositeKey` needs so a delimiter join is only credited
 * when both halves appear on the SAME object (the rendered JSONata concatenates
 * per object). Reuses the same extraction/aliasing as profiling, so field paths
 * match `buildFieldValueCountsForComposite`'s keys. */
function buildObjectFieldValues(
  sourceObjects: unknown[],
): Array<Map<string, Set<string>>> {
  return sourceObjects.map(object => {
    const perObject: Record<string, Record<string, number>> = {};
    extractStringValues(object, '$', perObject);
    return new Map(
      Object.entries(perObject).map(([field, counts]) => [
        field,
        new Set(Object.keys(counts)),
      ]),
    );
  });
}

/**
 * Composite synthesis inputs for the rescue loop, built once per
 * `buildSuggestionResultFromData` call and threaded through every
 * `attemptTransformRescue` call — mirrors `attemptFilterRescue`'s
 * `refinementCache` pattern.
 */
interface CompositeRescueContext {
  /** `buildFieldValueCountsForComposite`'s result — fixed for the whole call
   * (depends only on the run's own source profiles), so computed once here
   * instead of re-classifying every field's values per failed-transform
   * candidate. */
  fieldValueCounts: Record<string, Record<string, number>>;
  /** Per-object field values for the composite co-occurrence check — fixed for
   * the whole call (depends only on the run's own source objects). */
  objectFieldValues: Array<Map<string, Set<string>>>;
  /** Memoized `synthesizeCompositeKey` result keyed by
   * `${targetDatasourceId}|${targetField}` — `fieldValueCounts` is constant
   * for the call, so the referenced set (derived from the target profile) is
   * the only input that actually varies, and candidates that share a target
   * field (common when several source fields fail against the same
   * referenced field) would otherwise repeat the same ordered-pairs scan. */
  cache: Map<string, ReturnType<typeof synthesizeCompositeKey>>;
}

function synthesizeCompositeKeyMemoized(
  candidate: CandidateMatch,
  referencedValueSet: Set<string>,
  context: CompositeRescueContext,
): ReturnType<typeof synthesizeCompositeKey> {
  const key = `${candidate.targetDatasourceId}|${candidate.targetField}`;
  if (context.cache.has(key)) {
    return context.cache.get(key);
  }
  const result = synthesizeCompositeKey({
    candidateFieldValueCounts: context.fieldValueCounts,
    objectFieldValues: context.objectFieldValues,
    referencedValueSet,
  });
  context.cache.set(key, result);
  return result;
}

interface GateSuppressedEntry {
  candidate: CandidateMatch;
  sourceProfile?: FieldProfile;
  targetProfile?: FieldProfile;
  fieldMatch: FieldMatch;
  gateEvidence: Partial<GateEvidence>;
  reason: GateFailureReason;
  rescueHint?: GateRescueHint;
}

interface RescueOutcome {
  candidate: CandidateMatch;
  sourceProfile: FieldProfile | undefined;
  targetProfile: FieldProfile | undefined;
  scoringEvidence: GateEvidence;
  wireEvidence: Partial<GateEvidence>;
  rescue: {
    kind: 'transform' | 'filter';
    detail: string;
    originalField?: string;
  };
}

/**
 * try-transform: v1 only rescues the dependent-as-source direction (design
 * invariant) — a target-to-source containment failure means the SOURCE field
 * is actually the referenced side, which this generator never rewrites, so
 * it's skipped silently. Tries `synthesizeTransform` first (a genuine,
 * non-circular re-gate over `applyWithPassthrough`'s honest, full-coverage
 * distribution — see its doc comment for why the module's own
 * `transformedValueCounts` isn't reused here); falls back to
 * `synthesizeCompositeKey` only when that fails. A transform rescue always
 * forces `matchStrategy: 'exact'` — synthesis validated exact set
 * membership, so a contains/person_name_alias-discovered candidate must not
 * keep carrying its pre-rescue strategy.
 */
async function attemptTransformRescue(
  entry: GateSuppressedEntry,
  params: BuildSuggestionResultParams,
  compositeContext: CompositeRescueContext,
): Promise<RescueOutcome | undefined> {
  const { candidate, sourceProfile, targetProfile, gateEvidence } = entry;
  if (gateEvidence.containmentDirection !== 'source-to-target') {
    return undefined;
  }
  if (isReversedArrayContainsCandidate(candidate, params.datasourceId)) {
    return undefined;
  }
  if (!sourceProfile || !targetProfile) {
    return undefined;
  }

  const originalField = candidate.sourceField;
  const referencedValueSet = eligibleValueSet(targetProfile);
  const gateContext = buildGateContext(candidate, params);

  const plain = synthesizeTransform({
    dependentValueCounts: eligibleValueCounts(sourceProfile),
    referencedValueSet,
  });
  if (plain) {
    const rendered = plain.program.renderExpression(originalField);
    // Honest, full-coverage distribution (transformed + pass-through) — see
    // applyWithPassthrough's doc comment. This is what makes the re-gate's
    // containment below a genuine measurement instead of the module's own
    // (optimistic, match-only) transformedValueCounts.
    const honestValueCounts = applyWithPassthrough(
      plain.program,
      eligibleValueCounts(sourceProfile),
    );
    const syntheticProfile = buildSyntheticSourceProfile(
      rendered,
      honestValueCounts,
      sourceProfile.rowCount,
    );
    const regate = await applyCandidateGates(
      {
        sourceField: rendered,
        targetField: candidate.targetField,
        distinctMatchedValueCount: 0,
        sourceProfile: syntheticProfile,
        targetProfile,
      },
      gateContext,
    );
    if (regate.passed) {
      const matched = matchedValueCountsOf(
        honestValueCounts,
        referencedValueSet,
      );
      return {
        candidate: rebuildMatchEvidence(
          {
            ...candidate,
            sourceField: rendered,
            sourceExpression: rendered,
            matchStrategy: 'exact',
          },
          matched,
        ),
        sourceProfile: syntheticProfile,
        targetProfile,
        scoringEvidence: regate.evidence,
        wireEvidence: regate.evidence,
        rescue: {
          kind: 'transform',
          detail: plain.program.name,
          originalField,
        },
      };
    }
  }

  const composite = synthesizeCompositeKeyMemoized(
    candidate,
    referencedValueSet,
    compositeContext,
  );
  if (!composite) {
    return undefined;
  }
  const rendered = composite.program.renderExpression(originalField);
  const syntheticProfile = buildSyntheticSourceProfile(
    rendered,
    composite.transformedValueCounts,
    sourceProfile.rowCount,
  );
  const compositeGate = gateCompositeRescue(syntheticProfile, targetProfile);
  if (!compositeGate.passed) {
    return undefined;
  }
  // Composite's transformedValueCounts IS already the matched-referenced
  // intersection (unit-weighted) — no further filtering against
  // referencedValueSet needed, unlike the plain-transform path above.
  const matched = new Map(Object.entries(composite.transformedValueCounts));
  return {
    candidate: rebuildMatchEvidence(
      {
        ...candidate,
        sourceField: rendered,
        sourceExpression: rendered,
        matchStrategy: 'exact',
      },
      matched,
    ),
    sourceProfile: syntheticProfile,
    targetProfile,
    // Scoring needs a numeric containment; the composite's own synthesis
    // consistency (fraction of referenced values the join explains) is the
    // honest measure here — NOT a re-gated set intersection against
    // transformedValueCounts, which is circular by construction (see
    // gateCompositeRescue's doc comment).
    scoringEvidence: {
      containment: composite.consistency,
      containmentDirection: 'source-to-target',
      containmentVerified: false,
      referencedCardinalityRatio:
        compositeGate.evidence.referencedCardinalityRatio ?? 0,
      dependentDistinctCount:
        compositeGate.evidence.dependentDistinctCount ?? 0,
    },
    // Deliberately omits containment/containmentDirection/containmentVerified:
    // never claim a gate-measured containment for a composite rescue (see
    // gateCompositeRescue's doc comment) — only what compositeGate itself
    // honestly measured (trivial-domain + key-ness) reaches the wire.
    wireEvidence: compositeGate.evidence,
    rescue: {
      kind: 'transform',
      detail: composite.program.name,
      originalField,
    },
  };
}

/**
 * try-filter: slices the run's own source objects by each enum-sibling
 * refinement (`enumerateFilterRefinements`, already sorted/bounded) and
 * re-gates the candidate against the sliced profile; the first refinement
 * whose gates pass wins. `sourceField` is unchanged — only a filter is added
 * (matchStrategy is left as-is: filtering rows doesn't change how the
 * remaining values are compared, unlike a transform rescue).
 *
 * `refinementCache` memoizes `enumerateFilterRefinements` by sourceField
 * within one `buildSuggestionResultFromData` call: the enumeration's
 * expensive part (slicing + re-profiling every enum-field/value combination)
 * depends only on `(sourceObjects, sourceProfiles, candidateSourceField)`,
 * and the first two are fixed for the whole call — so candidates from this
 * run that share a sourceField (a source field commonly pairs with several
 * target fields across several target datasources) reuse the same
 * enumeration instead of repeating up to `FILTER_FIELD_MAX_DISTINCT *
 * MAX_ENUM_FIELDS_PER_CANDIDATE` slice-and-reprofile passes each.
 */
async function attemptFilterRescue(
  entry: GateSuppressedEntry,
  params: BuildSuggestionResultParams,
  refinementCache: Map<string, FilterRefinementResult[]>,
): Promise<RescueOutcome | undefined> {
  const { candidate, targetProfile } = entry;
  if (isReversedArrayContainsCandidate(candidate, params.datasourceId)) {
    return undefined;
  }
  if (params.sourceObjects.length === 0) {
    return undefined;
  }

  let refinements = refinementCache.get(candidate.sourceField);
  if (!refinements) {
    refinements = enumerateFilterRefinements({
      sourceObjects: params.sourceObjects,
      sourceProfiles: params.sourceProfiles,
      candidateSourceField: candidate.sourceField,
    });
    refinementCache.set(candidate.sourceField, refinements);
  }
  const gateContext = buildGateContext(candidate, params);
  const referencedValueSet = eligibleValueSet(targetProfile);

  for (const refinement of refinements) {
    const slicedSourceProfile =
      refinement.slicedProfiles.profilesByField[`${candidate.sourceField}`];
    if (!slicedSourceProfile) {
      continue;
    }
    const regate = await applyCandidateGates(
      {
        sourceField: candidate.sourceField,
        targetField: candidate.targetField,
        distinctMatchedValueCount: 0,
        sourceProfile: slicedSourceProfile,
        targetProfile,
      },
      gateContext,
    );
    if (!regate.passed) {
      continue;
    }
    const matched = matchedValueCountsOf(
      eligibleValueCounts(slicedSourceProfile),
      referencedValueSet,
    );
    return {
      candidate: rebuildMatchEvidence(
        {
          ...candidate,
          sourceFilterExpression: refinement.filterExpression,
        },
        matched,
      ),
      sourceProfile: slicedSourceProfile,
      targetProfile,
      scoringEvidence: regate.evidence,
      wireEvidence: regate.evidence,
      rescue: { kind: 'filter', detail: refinement.filterExpression },
    };
  }
  return undefined;
}

/**
 * Combines the two generators per the rescue loop's ordering: a
 * `try-transform` hint always attempts transform (plain, then composite)
 * first. Filter refinement is then tried whenever transform didn't succeed
 * AND either the gate's failure reason was `containment-below-threshold`
 * (the real-world archetype — a high-cardinality field noisy across an
 * enum-sibling's other values, clean once sliced — carries this reason with
 * or without a `try-transform` hint, since the hint additionally requires
 * both sides to look identifier-like) or the hint was `try-filter`
 * (trivial-domain's tiny-enum/dominant-value case, which has no direction to
 * check). A containment-below-threshold candidate is only filter-attempted
 * in the same v1 direction restriction as transform (dependent-as-source) —
 * slicing the run's own source objects can't fix a containment gap whose
 * dependent side is actually the candidate's *target* field.
 */
async function attemptRescue(
  entry: GateSuppressedEntry,
  params: BuildSuggestionResultParams,
  refinementCache: Map<string, FilterRefinementResult[]>,
  compositeContext: CompositeRescueContext,
): Promise<RescueOutcome | undefined> {
  if (entry.rescueHint === 'try-transform') {
    const transformed = await attemptTransformRescue(
      entry,
      params,
      compositeContext,
    );
    if (transformed) {
      return transformed;
    }
  }
  if (entry.reason === 'containment-below-threshold') {
    if (entry.gateEvidence.containmentDirection !== 'source-to-target') {
      return undefined;
    }
    return attemptFilterRescue(entry, params, refinementCache);
  }
  if (entry.rescueHint === 'try-filter') {
    return attemptFilterRescue(entry, params, refinementCache);
  }
  return undefined;
}

/** `FieldMatch` plus the resolve-internal conflict grouping key (see
 * buildSuggestionResultFromData's resolve pass) — never wire- or
 * persistence-visible, hence `stripConflictKeyField` below. */
type FieldMatchForResolve = FieldMatch & { conflictKeyField?: string };

/**
 * The resolve pass's conflict-resolution grouping key for a suggestion (see
 * resolveSuggestions.ts's `conflictKeyField`): the original dependent field a
 * transform-rescued candidate was rescued from — its own `sourceField`
 * becomes the rendered JSONata expression (see the rescue loop above), so
 * without this a plain and a rescued suggestion for the same original field
 * would key differently and both survive conflict resolution — or the
 * suggestion's own `sourceField` for every other candidate. Exported for unit
 * testing.
 */
export function conflictKeyFieldFor(suggestion: FieldMatch): string {
  return (
    suggestion.evidenceSummary.rescue?.originalField ?? suggestion.sourceField
  );
}

function stripConflictKeyField(suggestion: FieldMatchForResolve): FieldMatch {
  const { conflictKeyField: _conflictKeyField, ...rest } = suggestion;
  return rest;
}

/**
 * Turns a resolveSuggestions() suppression entry into the wire FieldMatch.
 * Score/band/evidence stay exactly as scored — resolve suppresses a
 * candidate for a global-conflict/rank-cliff/pair-cap reason, never because
 * the match itself was weak, so re-deriving those fields would be dishonest.
 * `entry.detail` (free-form human text — never parsed) is folded into
 * `explanation` as a `resolve: ` prefix ahead of the waterfall's own account,
 * mirroring how a rescue's detail is layered onto evidenceSummary rather than
 * replacing it.
 */
function toResolveSuppressedFieldMatch(entry: {
  suggestion: FieldMatch;
  reason: ResolveSuppressionReason;
  detail: string;
}): FieldMatch {
  return {
    ...entry.suggestion,
    suppressionReason: entry.reason,
    evidenceSummary: {
      ...entry.suggestion.evidenceSummary,
      explanation: `resolve: ${entry.detail} — ${entry.suggestion.evidenceSummary.explanation}`,
    },
  };
}

const REDUNDANT_FIELD_REASON = 'redundant-field';

/**
 * Rank among candidates competing to be the kept representative of a redundant
 * group: highest score first, then codepoint order of source then target field
 * — stable across ICU versions, so the winner is deterministic on identical
 * scores (mirrors resolveSuggestions' comparePairRank).
 */
function compareRedundantRank(a: FieldMatch, b: FieldMatch): number {
  if (b.score !== a.score) return b.score - a.score;
  const source = codepointCompare(a.sourceField, b.sourceField);
  if (source !== 0) return source;
  return codepointCompare(a.targetField, b.targetField);
}

function toRedundantSuppressedFieldMatch(
  suggestion: FieldMatch,
  keptSourceField: string,
): FieldMatch {
  return {
    ...suggestion,
    suppressionReason: REDUNDANT_FIELD_REASON,
    evidenceSummary: {
      ...suggestion.evidenceSummary,
      explanation: `redundant: same edge set as ${keptSourceField} — ${suggestion.evidenceSummary.explanation}`,
    },
  };
}

/**
 * Collapse co-linear redundant fields within one (source, target) pair. When a
 * target datasource holds a subset of the same objects as the source (e.g. the
 * same GitHub repos), every field is a perfect 1:1 key over the same objects, so
 * `name`, `ssh_url` and every `*_url` template each produce the IDENTICAL edge
 * set — ~25 candidates all describing a single relationship survive scoring.
 * Keep the best-scored representative per group and suppress the rest as
 * `redundant-field` (recoverable in the suppressed panel), so the review list
 * shows one rule, not 25.
 *
 * Eligibility is deliberately narrow: only a perfect key with full containment
 * (`containment === 1` and `referencedCardinalityRatio === 1`) — the 1:1
 * duplicate/subset signature. A fan-in relationship (ratio !== 1) or partial
 * containment is never collapsed, so genuinely distinct joins are left alone.
 * Candidates carry no object ids, so the grouping proxy is the pair's aggregate
 * shape (effective source + target datasource, suggestionKind, containment
 * direction, match count, distinct matched-value count); under the perfect-key
 * constraint an identical shape means the same objects map to the same objects.
 * Runs after resolve (over `resolved.kept`) so a pair whose best co-linear field
 * loses a cross-target conflict still keeps a surviving sibling field, rather
 * than the whole relationship vanishing.
 */
function collapseRedundantFieldMatches(
  suggestions: FieldMatch[],
  runDatasourceId: string,
): { kept: FieldMatch[]; suppressed: FieldMatch[] } {
  const groups = new Map<string, FieldMatch[]>();
  for (const suggestion of suggestions) {
    const gate = suggestion.evidenceSummary.gate;
    const eligible =
      gate?.containment === 1 && gate?.referencedCardinalityRatio === 1;
    if (!eligible) {
      continue;
    }
    const sourceDatasourceId = suggestion.sourceDatasourceId ?? runDatasourceId;
    const key = [
      sourceDatasourceId,
      suggestion.targetDatasourceId,
      suggestion.suggestionKind,
      gate?.containmentDirection ?? '',
      suggestion.matchCount,
      suggestion.evidenceSummary.distinctMatchedValueCount,
    ].join('|');
    const existing = groups.get(key);
    if (existing) {
      existing.push(suggestion);
    } else {
      groups.set(key, [suggestion]);
    }
  }

  const suppressedSet = new Set<FieldMatch>();
  const suppressed: FieldMatch[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const [winner, ...losers] = [...group].sort(compareRedundantRank);
    for (const loser of losers) {
      suppressedSet.add(loser);
      suppressed.push(
        toRedundantSuppressedFieldMatch(loser, winner.sourceField),
      );
    }
  }

  // Preserve the incoming (score-sorted) order for what survives.
  const kept = suggestions.filter(suggestion => !suppressedSet.has(suggestion));
  return { kept, suppressed };
}

export async function buildSuggestionResultFromData(
  params: BuildSuggestionResultParams,
): Promise<SuggestionResult> {
  const valueToFields = params.sourceProfiles.valueToFields;
  const values = Object.keys(valueToFields);
  const candidates = buildFieldMatchSuggestions(
    valueToFields,
    params.searchResults,
    params.sourceProfiles.profilesByField,
    params.targetProfilesByDatasource ?? {},
    params.datasourceId,
  ).map(candidate => ({
    ...candidate,
    contributedBy: candidate.contributedBy ?? ['deterministic'],
  }));

  const scoringParams: ScoringParams = {
    runDatasourceId: params.datasourceId,
    idf: params.idf,
    uBySignal: params.uBySignal,
    datasourceNamesById: params.datasourceNamesById,
    sampleScaleByDatasourceId: params.sampleScaleByDatasourceId,
    calibration: params.calibration,
  };

  // Gates run on every candidate before any scoring. Sequential for..of (not
  // Promise.all) keeps output order deterministic.
  const suggestions: FieldMatch[] = [];
  const gateSuppressed: FieldMatch[] = [];
  const scoreSuppressed: FieldMatch[] = [];
  const gateSuppressedEntries: GateSuppressedEntry[] = [];
  for (const candidate of candidates) {
    const { sourceProfile, targetProfile } = resolveGateProfiles(
      candidate,
      params,
    );
    const gateResult = await applyCandidateGates(
      {
        sourceField: candidate.sourceField,
        targetField: candidate.targetField,
        distinctMatchedValueCount: candidate.distinctMatchedValueCount,
        // The matched values mapped back to canonical SOURCE values (an alias
        // token → the name it expanded from) and deduped, so containment/
        // support coverage counts distinct source values that exist in the
        // source domain. Without the mapping, alias tokens (never stored in the
        // profile) intersect to 0 and drop real people joins; without the cap
        // they inflate past 1.0 (a live rule hit 2.09). The lookup is scoped to
        // THIS candidate's source field — a datasource-wide table would rewrite
        // a token that is a genuine value here to a canonical from a different
        // field, dropping a real identifier join.
        matchedValues: [
          ...new Set(
            [...candidate.valueCounts.keys()].map(
              value =>
                params.sourceProfiles.canonicalByAlias[
                  `${candidate.sourceField}`
                ]?.[`${value}`] ?? value,
            ),
          ),
        ],
        matchStrategy: candidate.matchStrategy,
        sourceProfile,
        targetProfile,
      },
      buildGateContext(candidate, params),
    );

    if (!gateResult.passed) {
      const fieldMatch = toGateSuppressedFieldMatch(
        candidate,
        sourceProfile,
        targetProfile,
        gateResult.reason,
        gateResult.evidence,
        gateResult.rescueHint,
      );
      gateSuppressed.push(fieldMatch);
      gateSuppressedEntries.push({
        candidate,
        sourceProfile,
        targetProfile,
        fieldMatch,
        gateEvidence: gateResult.evidence,
        reason: gateResult.reason,
        rescueHint: gateResult.rescueHint,
      });
      continue;
    }

    const outcome = scoreCandidate(
      candidate,
      gateResult.evidence,
      gateResult.evidence,
      sourceProfile,
      targetProfile,
      scoringParams,
    );
    if (outcome.kind === 'suppressed') {
      scoreSuppressed.push(outcome.fieldMatch);
    } else {
      suggestions.push(outcome.fieldMatch);
    }
  }

  // Rescue loop: gate-suppressed candidates worth attempting — either they
  // carry a rescueHint, or the failure was containment-below-threshold (the
  // real-world "clean under a slice" archetype can carry this reason without
  // a hint; see attemptRescue) — MINUS entries attemptRescue can never
  // actually rescue regardless of cap room: a reversed array_contains
  // candidate (both generators require the run's own source-side profiles)
  // and, for the containment-below-threshold reason specifically, a
  // target-to-source direction (attemptTransformRescue requires
  // source-to-target, and attemptRescue's own filter fallback for this reason
  // re-checks the same direction before ever calling attemptFilterRescue —
  // see its doc comment). Filtering these out here, before the cap slice,
  // means they no longer burn a RESCUE_ATTEMPT_CAP slot that a genuinely
  // rescuable candidate later in iteration order could have used instead.
  // The per-attempt guards inside attemptTransformRescue/attemptRescue stay
  // as belt-and-braces.
  const rescuable = gateSuppressedEntries
    .filter(
      entry =>
        entry.rescueHint !== undefined ||
        entry.reason === 'containment-below-threshold',
    )
    .filter(
      entry =>
        !isReversedArrayContainsCandidate(entry.candidate, params.datasourceId),
    )
    .filter(
      entry =>
        entry.reason !== 'containment-below-threshold' ||
        entry.gateEvidence.containmentDirection === 'source-to-target',
    )
    .slice(0, RESCUE_ATTEMPT_CAP);
  // Memoized per this call (= per source datasource per run) across every
  // filter-rescue attempt below — see attemptFilterRescue's doc comment.
  const filterRefinementCache = new Map<string, FilterRefinementResult[]>();
  // Built/memoized once per call — see CompositeRescueContext's doc comment.
  const compositeRescueContext: CompositeRescueContext = {
    fieldValueCounts: buildFieldValueCountsForComposite(params.sourceProfiles),
    objectFieldValues: buildObjectFieldValues(params.sourceObjects),
    cache: new Map(),
  };
  // Rescued survivors that still land below the FS-score band threshold —
  // kept separate from the main loop's scoreSuppressed so they can be
  // ordered right after gateSuppressed (see the return below).
  const rescuedScoreSuppressed: FieldMatch[] = [];
  // Emitted rescue rule identities, to drop duplicates at the source. A
  // composite rescue renders `fieldA & delim & fieldB` — independent of the
  // failed candidate's own source field — so two different source fields that
  // share a target rescue to the SAME expression and would otherwise both be
  // emitted (they only collide again at persistence, and the resolve pass
  // keys them apart by their distinct originalField, so it can't collapse
  // them). Keying on the rendered (sourceExpression, targetDatasource,
  // targetField) — the rule's own identity within this per-source call —
  // emits each once. Plain transforms embed the original field in their
  // rendered expression, so they stay distinct and none are dropped.
  const emittedRescueIdentities = new Set<string>();
  for (const entry of rescuable) {
    const rescued = await attemptRescue(
      entry,
      params,
      filterRefinementCache,
      compositeRescueContext,
    );
    if (!rescued) {
      continue;
    }

    const rescueIdentity = `${
      rescued.candidate.sourceExpression ?? rescued.candidate.sourceField
    }|${rescued.candidate.targetDatasourceId}|${rescued.candidate.targetField}`;
    if (emittedRescueIdentities.has(rescueIdentity)) {
      // A duplicate of an already-emitted rescue (the composite case above).
      // Leave this entry gate-suppressed rather than emitting an identical
      // second suggestion.
      continue;
    }
    emittedRescueIdentities.add(rescueIdentity);

    const suppressedIndex = gateSuppressed.indexOf(entry.fieldMatch);
    if (suppressedIndex !== -1) {
      gateSuppressed.splice(suppressedIndex, 1);
    }

    const outcome = scoreCandidate(
      rescued.candidate,
      rescued.scoringEvidence,
      rescued.wireEvidence,
      rescued.sourceProfile,
      rescued.targetProfile,
      scoringParams,
    );
    const rescuedFieldMatch = withRescueEvidence(
      outcome.fieldMatch,
      rescued.rescue,
    );
    if (outcome.kind === 'suppressed') {
      rescuedScoreSuppressed.push(rescuedFieldMatch);
    } else {
      suggestions.push(rescuedFieldMatch);
    }
  }

  suggestions.sort((a, b) => b.score - a.score);

  // Global resolve pass — conflict resolution, rank-cliff, per-pair cap (see
  // resolveSuggestions.ts) — runs once per source datasource over every FS
  // survivor, including rescued ones merged in above. `kept` replaces the
  // scored `suggestions` array as this call's actual result.
  //
  // conflictKeyField collapses a transform-rescued candidate back onto the
  // original dependent field it was rescued from: its `sourceField` becomes
  // the rendered JSONata expression (see the rescue loop above), so without
  // this the conflict pass would key it separately from a plain suggestion
  // for the same original field and both would survive. Stripped again
  // below the resolve call — it's a resolve-internal key, never wire- or
  // persistence-visible.
  const suggestionsForResolve = suggestions.map(suggestion => ({
    ...suggestion,
    conflictKeyField: conflictKeyFieldFor(suggestion),
  }));
  const resolved = resolveSuggestions(
    suggestionsForResolve,
    params.datasourceId,
  );
  const resolveSuppressed = resolved.suppressed.map(entry =>
    toResolveSuppressedFieldMatch({
      ...entry,
      suggestion: stripConflictKeyField(entry.suggestion),
    }),
  );

  // Collapse co-linear redundant fields (see collapseRedundantFieldMatches):
  // a subset/duplicate target datasource makes every field a perfect key over
  // the same objects, so ~25 candidates describe one relationship. Runs AFTER
  // resolve so a pair whose collapse representative would lose a cross-target
  // conflict still keeps a sibling co-linear field: resolve prunes cross-target
  // conflicts (grouped per source field, across targets) first, then collapse
  // dedupes whatever survived within each pair — so a real relationship never
  // disappears just because its best field lost to another target.
  const { kept, suppressed: redundantSuppressed } =
    collapseRedundantFieldMatches(
      resolved.kept.map(stripConflictKeyField),
      params.datasourceId,
    );

  return {
    datasourceId: params.datasourceId,
    total: params.total,
    candidateValueCount: values.length,
    searchResultCount: params.searchResults.length,
    suggestions: kept,
    // Gate-suppressed entries carry the review-facing evidence
    // (suppressionReason/rescueHint/gate) that a noisy score-suppressed
    // majority would otherwise evict from SchemaController's
    // SUPPRESSED_RESPONSE_CAP slice — order them first so that cap always
    // keeps them. Rescued-but-still-score-suppressed entries go right after:
    // they replaced a gate-suppressed entry (which carried the same
    // review-facing priority) and would otherwise be evicted by the same cap
    // if left at the end behind every ordinary score-suppressed entry.
    // Resolve-suppressed entries go next: they were genuine FS-score
    // survivors (never weak matches) suppressed only by the global
    // conflict/cliff/cap pass, so they outrank the ordinary
    // score-suppressed tail for the same cap-eviction reason as the rescued
    // ones above them. Redundant-field entries follow: they too are FS-score
    // survivors (a perfect key over the same objects), suppressed only for
    // being co-linear with a kept representative, so they outrank the ordinary
    // score-suppressed tail. Ordinary score-suppressed entries — the largest
    // and least review-relevant bucket — stay last.
    suppressedSuggestions: [
      ...gateSuppressed,
      ...rescuedScoreSuppressed,
      ...resolveSuppressed,
      ...redundantSuppressed,
      ...scoreSuppressed,
    ],
  };
}

/** max(1, corpusTotal / sampledCount), guarding a zero-item sample. */
function sampleScaleFor(corpus: SuggestionCorpus): number {
  return corpus.items.length === 0
    ? 1
    : Math.max(1, corpus.total / corpus.items.length);
}

export async function buildSuggestions(
  objectDao: ObjectDao,
  datasourceId: string,
  targetDatasourceIds: string[],
  corpusCache?: SuggestionCorpusCache,
  datasourceNamesById?: Record<string, string>,
  calibration: ScoreCalibration = IDENTITY_CALIBRATION,
  workspaceId?: string,
): Promise<SuggestionResult> {
  // A caller-provided cache shares samples and profiles across the whole run
  // (each datasource in a batch is both a source once and a target N-1
  // times); a private one still deduplicates within this call.
  const cache =
    corpusCache ?? new SuggestionCorpusCache(objectDao, workspaceId);
  const sourceCorpus = await cache.get(datasourceId);
  const values = Object.keys(sourceCorpus.profiles.valueToFields);

  if (targetDatasourceIds.length === 0) {
    return buildSuggestionResultFromData({
      datasourceId,
      total: sourceCorpus.total,
      sourceProfiles: sourceCorpus.profiles,
      sourceObjects: sourceCorpus.objects,
      searchResults: [],
      idf: buildTokenIdf({
        fieldPathsByDatasource: {
          [datasourceId]: Object.keys(sourceCorpus.profiles.profilesByField),
        },
        containerNamesByDatasourceId: datasourceNamesById,
      }),
      uBySignal: new Map(),
      datasourceNamesById,
      calibration,
    });
  }

  const targetCorpora = await Promise.all(
    targetDatasourceIds.map(targetDatasourceId =>
      cache.get(targetDatasourceId),
    ),
  );
  const targetSamples = targetCorpora.map(corpus => ({
    targetDatasourceId: corpus.datasourceId,
    sample: { items: corpus.items, total: corpus.total },
  }));
  const sourceValues = new Set(values);
  const searchResults = collectExactSearchResults({
    sourceValues,
    targetSamples,
  });
  const aliasSearchResults = collectTargetAliasSearchResults({
    sourceValues,
    targetSamples,
  });
  const sourceValuesByType = partitionSourceValuesByType(sourceValues);
  const fuzzySearchResults = collectFuzzySearchResults({
    sourceValues,
    exactSourceValuesByType: sourceValuesByType,
    targetSamples,
  });
  const containsSearchResults = collectPrefixContainsResults({
    sourceValues,
    exactSourceValuesByType: sourceValuesByType,
    targetSamples,
  });
  const combinedSearchResults = dedupeSearchResults([
    ...searchResults,
    ...aliasSearchResults,
    ...fuzzySearchResults,
    ...containsSearchResults,
  ]);

  // idf/measured-u span the whole run's corpora (source + every target) —
  // computed once here, not per candidate, so every candidate in this run is
  // scored against the same reference frame (Task 4's determinism contract).
  const allCorpora = [sourceCorpus, ...targetCorpora];
  const idf = buildTokenIdf({
    fieldPathsByDatasource: Object.fromEntries(
      allCorpora.map(corpus => [
        corpus.datasourceId,
        Object.keys(corpus.profiles.profilesByField),
      ]),
    ),
    containerNamesByDatasourceId: datasourceNamesById,
  });
  const uBySignal = measureU({
    corpora: allCorpora.map(corpus => ({
      datasourceId: corpus.datasourceId,
      profilesByField: corpus.profiles.profilesByField,
      containerName: datasourceNamesById?.[corpus.datasourceId],
    })),
    idf,
  });
  const sampleScaleByDatasourceId = Object.fromEntries(
    allCorpora.map(corpus => [corpus.datasourceId, sampleScaleFor(corpus)]),
  );

  return buildSuggestionResultFromData({
    datasourceId,
    total: sourceCorpus.total,
    sourceProfiles: sourceCorpus.profiles,
    sourceObjects: sourceCorpus.objects,
    searchResults: combinedSearchResults,
    targetProfilesByDatasource: Object.fromEntries(
      targetCorpora.map(corpus => [
        corpus.datasourceId,
        corpus.profiles.profilesByField,
      ]),
    ),
    // Keyed by every datasource whose profile could end up as a gate's
    // *target* side — the run's other datasources, plus this run's own
    // source datasource, which fills that role for a reversed
    // array_contains candidate (see resolveGateProfiles).
    targetCorpusPartialByDatasource: {
      [datasourceId]: sourceCorpus.total > sourceCorpus.items.length,
      ...Object.fromEntries(
        targetCorpora.map(corpus => [
          corpus.datasourceId,
          corpus.total > corpus.items.length,
        ]),
      ),
    },
    verifyValuesPresent: (targetDatasourceId, targetField, values) =>
      objectDao.findValuesPresent(
        targetDatasourceId,
        targetField,
        values,
        workspaceId,
      ),
    idf,
    uBySignal,
    sampleScaleByDatasourceId,
    datasourceNamesById,
    calibration,
  });
}

export interface SuggestionPairGroup {
  datasourceIds: [string, string];
  suggestions: FieldMatch[];
}

/**
 * Groups a run's surviving suggestions by unordered datasource pair, for a
 * per-pair review UI. A pair evaluated from both directions can rediscover
 * the same field join twice (A.f → B.g and B.g → A.f); within a pair only
 * the higher-scoring direction of such a mirror is kept, matching which
 * rule persistNewRules would retain.
 */
/**
 * Enforce PAIR_PERSIST_CAP across BOTH directions of an unordered pair.
 * `resolveSuggestions` already caps each pair, but it runs once per source
 * datasource, so a batch Generate caps `A→B` and `B→A` independently and an
 * unordered pair could persist up to 2× the cap. This second pass runs over
 * the whole batch's combined survivors: it keeps the top PAIR_PERSIST_CAP per
 * unordered pair by score and demotes the overflow to `over-pair-cap`
 * suppressions, so persistence and the review grouping both honour the cap.
 *
 * A no-op for a single-source run (only one direction exists) — the returned
 * results are new objects only where something was demoted.
 */
export function capSuggestionsByUnorderedPair(
  results: SuggestionResult[],
): SuggestionResult[] {
  const unorderedPairKey = (result: SuggestionResult, s: FieldMatch): string =>
    [s.sourceDatasourceId ?? result.datasourceId, s.targetDatasourceId]
      .sort(codepointCompare)
      .join('|');

  // Rank a pair's combined suggestions: score desc, then a stable codepoint
  // tie-break so the kept set is deterministic across directions.
  const rank = (a: FieldMatch, b: FieldMatch): number => {
    if (a.score !== b.score) return b.score - a.score;
    return (
      codepointCompare(a.targetDatasourceId, b.targetDatasourceId) ||
      codepointCompare(a.targetField, b.targetField) ||
      codepointCompare(a.sourceField, b.sourceField)
    );
  };

  const byPair = new Map<string, FieldMatch[]>();
  for (const result of results) {
    for (const suggestion of result.suggestions) {
      const key = unorderedPairKey(result, suggestion);
      byPair.set(key, [...(byPair.get(key) ?? []), suggestion]);
    }
  }

  const overCap = new Set<FieldMatch>();
  for (const group of byPair.values()) {
    if (group.length <= PAIR_PERSIST_CAP) continue;
    [...group]
      .sort(rank)
      .slice(PAIR_PERSIST_CAP)
      .forEach(suggestion => overCap.add(suggestion));
  }
  if (overCap.size === 0) return results;

  return results.map(result => {
    const demoted = result.suggestions.filter(s => overCap.has(s));
    if (demoted.length === 0) return result;
    const demotedReceipts = demoted.map(suggestion => ({
      ...suggestion,
      suppressionReason: 'over-pair-cap' as ResolveSuppressionReason,
      evidenceSummary: {
        ...suggestion.evidenceSummary,
        explanation: `resolve: pair cap exceeded across both directions (cap=${PAIR_PERSIST_CAP}) — ${suggestion.evidenceSummary.explanation}`,
      },
    }));
    // Insert ahead of the score-below-threshold tail, not at the end: that
    // tail is the evictable majority, and SchemaController slices to
    // SUPPRESSED_RESPONSE_CAP. Appending would push these receipts past the
    // slice, so the review would omit why those survivors were dropped —
    // per-source resolve keeps its own reasons ahead of that tail for the
    // same reason.
    const existing = result.suppressedSuggestions;
    const tailStart = existing.findIndex(
      s => s.suppressionReason === 'score-below-threshold',
    );
    const insertAt = tailStart === -1 ? existing.length : tailStart;
    return {
      ...result,
      suggestions: result.suggestions.filter(s => !overCap.has(s)),
      suppressedSuggestions: [
        ...existing.slice(0, insertAt),
        ...demotedReceipts,
        ...existing.slice(insertAt),
      ],
    };
  });
}

export function groupSuggestionsByPair(
  results: SuggestionResult[],
): SuggestionPairGroup[] {
  const groups = new Map<
    string,
    { datasourceIds: [string, string]; byJoin: Map<string, FieldMatch> }
  >();
  for (const result of results) {
    for (const suggestion of result.suggestions) {
      const sourceDatasourceId =
        suggestion.sourceDatasourceId ?? result.datasourceId;
      const enriched = { ...suggestion, sourceDatasourceId };
      const pairIds = [sourceDatasourceId, suggestion.targetDatasourceId].sort(
        codepointCompare,
      ) as [string, string];
      const pairKey = pairIds.join('|');
      let group = groups.get(pairKey);
      if (!group) {
        group = { datasourceIds: pairIds, byJoin: new Map() };
        groups.set(pairKey, group);
      }
      const joinKey = [
        `${sourceDatasourceId}:${suggestion.sourceField}`,
        `${suggestion.targetDatasourceId}:${suggestion.targetField}`,
      ]
        .sort(codepointCompare)
        .join('|');
      const existing = group.byJoin.get(joinKey);
      if (!existing || existing.score < enriched.score) {
        group.byJoin.set(joinKey, enriched);
      }
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => codepointCompare(a, b))
    .map(([, group]) => ({
      datasourceIds: group.datasourceIds,
      suggestions: [...group.byJoin.values()].sort((a, b) => b.score - a.score),
    }));
}

/**
 * The origin stamped on every rule this generator persists. Suggested rules
 * can also come from other actors — MCP agents propose rules as `suggested`
 * for human review, and integration-backed drafts are unreproducible by this
 * pipeline — so every destructive or overwriting path below must check
 * ownership first and leave foreign rules alone.
 */
export const GENERATOR_ORIGIN = 'generated';

export function isGeneratorOwnedRule(rule: RelationshipRule): boolean {
  return rule.origin === GENERATOR_ORIGIN && rule.strategy === 'field-matching';
}

/**
 * Soft-expires unreviewed `state: 'suggested'` rules from prior Generate runs
 * that did not surface in the current run. Each Generate is treated as a
 * snapshot of the current suggestions: anything the deterministic + fuzzy
 * pipeline no longer produces gets transitioned to `inactive` with
 * `reviewReason: 'auto-staled'` (distinct from `manual-dismiss` so insights
 * can tell user-driven dismissals apart from auto-cleanup). User-approved
 * (`active`) and user-dismissed (`inactive` with `manual-dismiss`) rules are
 * left untouched.
 */
async function staleUnreviewedSuggestions(
  relationshipRuleDao: RelationshipRuleDao,
  results: SuggestionResult[],
  activeDatasourceIds: Set<string>,
  workspaceId?: string,
): Promise<number> {
  let staledCount = 0;
  for (const result of results) {
    const currentKeys = new Set(
      result.suggestions
        .filter(
          s =>
            (s.sourceDatasourceId ?? result.datasourceId) ===
              result.datasourceId &&
            activeDatasourceIds.has(s.targetDatasourceId),
        )
        .map(s => `${s.targetDatasourceId}|${s.sourceField}|${s.targetField}`),
    );

    const priorSuggested =
      await relationshipRuleDao.listRelationshipRulesByDatasourceId(
        result.datasourceId,
        { state: 'suggested', workspaceId },
      );

    for (const rule of priorSuggested) {
      if (!isGeneratorOwnedRule(rule)) {
        continue;
      }
      if (rule.sourceDatasourceId !== result.datasourceId) {
        continue;
      }
      if (!activeDatasourceIds.has(rule.targetDatasourceId)) {
        continue;
      }
      const key = `${rule.targetDatasourceId}|${rule.sourceFieldExpression}|${rule.targetFieldExpression}`;
      if (currentKeys.has(key)) {
        continue;
      }
      await relationshipRuleDao.updateRelationshipRuleState(
        rule.id,
        'inactive',
        { reviewReason: 'auto-staled', workspaceId },
      );
      staledCount += 1;
    }
  }
  return staledCount;
}

export async function persistNewRules(
  relationshipRuleDao: RelationshipRuleDao,
  results: SuggestionResult[],
  activeDatasourceIds: Set<string>,
  workspaceId?: string,
) {
  await staleUnreviewedSuggestions(
    relationshipRuleDao,
    results,
    activeDatasourceIds,
    workspaceId,
  );

  const createdRules = [];
  const toRuleInput = (result: SuggestionResult, suggestion: FieldMatch) => ({
    name: `${suggestion.sourceField} → ${suggestion.targetField}`,
    sourceDatasourceId: suggestion.sourceDatasourceId ?? result.datasourceId,
    targetDatasourceId: suggestion.targetDatasourceId,
    sourceFieldExpression: suggestion.sourceField,
    targetFieldExpression: suggestion.targetField,
    // suggestion.sourceField already IS the rendered JSONata for a
    // transform-rescued candidate (see the rescue loop's design invariant);
    // this only threads a filter rescue's added JSONata boolean. `?? null`
    // (not left `undefined`): the DAO's update skips a field entirely when
    // it's `undefined`, so an existing rule refreshed by a higher-scoring
    // unfiltered suggestion must send an explicit `null` to actually clear a
    // stale filter — leaving it `undefined` would let the old narrowing
    // filter silently keep materializing.
    sourceFilterExpression: suggestion.sourceFilterExpression ?? null,
    relationshipType: suggestion.relationshipType ?? 'relatedTo',
    reciprocalRelationshipType:
      suggestion.reciprocalRelationshipType ?? 'relatesTo',
    matchStrategy: suggestion.matchStrategy ?? 'exact',
    origin: GENERATOR_ORIGIN,
    suggestionKind: suggestion.suggestionKind,
    score: suggestion.score,
    confidenceBand: suggestion.confidenceBand,
    evidenceSummary: suggestion.evidenceSummary,
  });

  // Refreshes a generator-owned rule that covers the same field pair as a
  // suggestion the current run produced. An `auto-staled` rule is brought
  // back for review — its evidence reappeared, and unlike `manual-dismiss`
  // that expiry carries no human decision. A still-suggested rule is
  // rewritten only when the new evidence scores higher — UNLESS the stored
  // rule predates this stage's rewire (Task 5): its `score` was produced by
  // the old additive heuristic scorer (0-1 on a completely different scale
  // from an FS probability) and its `evidenceSummary` carries no
  // `waterfall`. Comparing across those two scales would make the old
  // scorer's most "confident" rules (near 1.0) permanently un-refreshable,
  // exactly backwards from the migration story (spec §5: every rule
  // re-scores via the overwrite path on its next Generate). One-generation
  // fix: an old-format rule always loses the comparison and gets rewritten
  // once; after that it carries a waterfall and the real score comparison
  // applies going forward.
  const refreshExistingRule = async (
    rule: RelationshipRule,
    input: ReturnType<typeof toRuleInput>,
    score: number,
  ): Promise<void> => {
    if (!isGeneratorOwnedRule(rule)) {
      return;
    }
    if (rule.state === 'inactive' && rule.reviewReason === 'auto-staled') {
      await relationshipRuleDao.updateRelationshipRule(
        rule.id,
        input,
        workspaceId,
      );
      await relationshipRuleDao.updateRelationshipRuleState(
        rule.id,
        'suggested',
        { reviewReason: null, workspaceId },
      );
      return;
    }
    const isOldFormatScore = rule.evidenceSummary?.waterfall === undefined;
    if (
      rule.state === 'suggested' &&
      (isOldFormatScore || (rule.score ?? 0) < score)
    ) {
      await relationshipRuleDao.updateRelationshipRule(
        rule.id,
        input,
        workspaceId,
      );
    }
  };

  for (const result of results) {
    for (const suggestion of result.suggestions) {
      const sourceDatasourceId =
        suggestion.sourceDatasourceId ?? result.datasourceId;
      if (!activeDatasourceIds.has(suggestion.targetDatasourceId)) {
        continue;
      }
      const input = toRuleInput(result, suggestion);
      const existing = await relationshipRuleDao.findExistingRule({
        workspaceId,
        sourceDatasourceId,
        targetDatasourceId: suggestion.targetDatasourceId,
        sourceFieldExpression: suggestion.sourceField,
        targetFieldExpression: suggestion.targetField,
      });
      if (existing) {
        await refreshExistingRule(existing, input, suggestion.score);
        continue;
      }
      const reverseExisting = await relationshipRuleDao.findExistingRule({
        workspaceId,
        sourceDatasourceId: suggestion.targetDatasourceId,
        targetDatasourceId: sourceDatasourceId,
        sourceFieldExpression: suggestion.targetField,
        targetFieldExpression: suggestion.sourceField,
      });
      if (reverseExisting) {
        await refreshExistingRule(reverseExisting, input, suggestion.score);
        continue;
      }
      const rule = await relationshipRuleDao.createRelationshipRule(input, {
        workspaceId,
        state: 'suggested',
      });
      createdRules.push(rule);
    }
  }
  return createdRules;
}
