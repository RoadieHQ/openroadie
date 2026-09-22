import type {
  RelationshipSuggestionFieldSemantic,
  RelationshipSuggestionSemanticCompatibility,
} from '@roadiehq/catalog-datastore-common';
import { pathSegments } from '../_shared';
import { bhattacharyyaAgreement } from './distributionAgreement';
import type { FieldProfile } from './field-profiling';
import { NAME_SIMILARITY_MIN, nameSimilarity } from './nameSimilarity';
import { applyCalibration, type ScoreCalibration } from './scoreCalibration';
import {
  classifyRelationshipFieldSemantic,
  semanticCompatibility,
} from './semanticFieldClassification';

export const PRIOR_LOG_ODDS = -5;
export const HIGH_BAND_MIN_P = 0.9;
export const MEDIUM_BAND_MIN_P = 0.7;
export const U_FLOOR = 0.005;
export const FAN_OUT_SANITY_MAX = 50;
export const DISTRIBUTION_AGREEMENT_MIN_BC = 0.75;

/**
 * Direction contract: `source`/`sourceField`/`sourceProfile` is always the
 * DEPENDENT side (the foreign-key-shaped field whose values are being looked
 * up); `target`/`targetField`/`targetProfile` and the whole `referenced*`
 * trio below are always the REFERENCED side (the dimension/lookup field the
 * dependent side's values are checked against). Stage 2's gate reports
 * `containmentDirection` as `'source-to-target'` or `'target-to-source'` in
 * terms of the *candidate's original* source/target labels — when it comes
 * back `'target-to-source'`, the caller building this context MUST swap
 * sides (feed the gate's target as `sourceField`/`sourceProfile` and its
 * source as `targetField`/`targetProfile`/the `referenced*` fields) before
 * calling `fsScoreCandidate`. This module never sees `containmentDirection`
 * and cannot detect or correct a mislabeled pair itself.
 */
export interface SignalContext {
  sourceField: string;
  targetField: string;
  sourceProfile?: FieldProfile;
  targetProfile?: FieldProfile;
  /** Stage 2 gate output for this candidate (survivors always have it). */
  containment: number;
  /** matched value -> match count, from the accumulator */
  matchedValueCounts: Map<string, number>;
  /** corpus frequency of each matched value on the referenced (target) side */
  referencedValueCounts?: Record<string, number>;
  idf: Map<string, number>;
  /** Container (table) name of the referenced (target) side. */
  referencedContainerName?: string;
  /** referenced-side sample coverage: corpus total / sampled rows (≥ 1) */
  referencedSampleScale: number;
}

export type SignalFired = boolean | undefined; // undefined = skipped

export interface SignalDefinition {
  name: string;
  m: number;
  uSeed: number;
  /** Skip this signal in u-estimation's random-pair measurement — always use
   * `uSeed`. For signals whose true false-positive rate on a random cross-
   * datasource pair isn't representative of an actual candidate's population
   * (see `hierarchy-context`'s row below), measuring it would corrupt, not
   * calibrate, its weight. */
  fixedU?: boolean;
  evaluate(context: SignalContext): SignalFired;
}

export interface WaterfallEntry {
  signal: string;
  fired: boolean; // skipped signals are omitted from the waterfall
  weight: number; // log2 contribution, rounded to 3 decimals
  detail?: string; // human fragment, e.g. "containment 0.99"
}

export interface FsScore {
  probability: number; // rounded to 4 decimals
  logOdds: number; // prior + Σ weights, rounded to 4 decimals
  band: 'high' | 'medium' | 'low';
  waterfall: WaterfallEntry[]; // prior first, then table order
  explanation: string; // top-3 |weight| entries + prior + p
}

// Names of signals with a documented cross-signal dependency, resolved by
// fsScoreCandidate's second pass (see below) — the table's own evaluators
// stay pure functions of `context` alone.
const NAME_SIMILARITY_SIGNAL = 'name-similarity';
const KEY_KEY_PENALTY_SIGNAL = 'key-key-penalty';
const VALUE_RARITY_SIGNAL = 'value-rarity';
const FAN_OUT_SANITY_SIGNAL = 'fan-out-sanity';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[Number(mid - 1)] + sorted[Number(mid)]) / 2
    : sorted[Number(mid)];
}

// Both signal-table semantic entries (7a/7b) skip together on the same
// condition and otherwise share the same classify -> compatibility pipeline;
// computing it once here keeps that single source of truth instead of
// duplicating the classification calls per entry. 'weak-domain' means "no
// evidence either way" — whether because a side classified as unknown, or
// because the pair is a known-but-unlisted combination that
// semanticCompatibility's fallthrough also reports as weak-domain — so both
// signals skip on it rather than treating it as a false compatible/mismatch.
// Aligned with relationshipTypeInference.ts's parent-token bucket (line
// ~90: 'parent', 'parentid', 'parent_of', 'parentof') plus a few extra
// ancestor-style tokens, so this signal and the childOf/parentOf verb
// inference agree on the same field shapes. Matched against both the raw
// segment and its underscore/hyphen-collapsed form, mirroring how that
// file's own `lookup()` resolves a compound segment like `parent_id` to the
// collapsed token `parentid`.
const HIERARCHY_CONTEXT_TOKENS = new Set([
  'parent',
  'parentid',
  'parent_of',
  'parentof',
  '_parent',
  'ancestor',
  'ancestors',
]);

function collapseSegment(segment: string): string {
  return segment.replace(/[_-]/g, '');
}

function hasHierarchyContextSegment(field: string): boolean {
  return pathSegments(field).some(
    segment =>
      HIERARCHY_CONTEXT_TOKENS.has(segment) ||
      HIERARCHY_CONTEXT_TOKENS.has(collapseSegment(segment)),
  );
}

function semanticCompatibilityFor(
  context: SignalContext,
): RelationshipSuggestionSemanticCompatibility | undefined {
  const sourceSemantic: RelationshipSuggestionFieldSemantic =
    classifyRelationshipFieldSemantic(context.sourceField);
  const targetSemantic: RelationshipSuggestionFieldSemantic =
    classifyRelationshipFieldSemantic(
      context.targetField,
      context.referencedContainerName,
    );
  const compatibility = semanticCompatibility(sourceSemantic, targetSemantic);
  return compatibility === 'weak-domain' ? undefined : compatibility;
}

export const SIGNAL_TABLE: SignalDefinition[] = [
  {
    name: 'containment-0.99',
    m: 0.55,
    uSeed: 0.01,
    // Containment is an honest ≤ 1 fraction (alias-variant inflation is
    // intersected away in candidateGates' matchedInSourceCount).
    evaluate: context => context.containment >= 0.99,
  },
  {
    name: 'containment-0.95',
    m: 0.25,
    uSeed: 0.02,
    evaluate: context =>
      context.containment >= 0.95 && context.containment < 0.99,
  },
  {
    name: 'containment-0.85',
    m: 0.15,
    uSeed: 0.05,
    evaluate: context =>
      context.containment >= 0.85 && context.containment < 0.95,
  },
  {
    name: 'distribution-agreement',
    m: 0.7,
    uSeed: 0.15,
    evaluate: context => {
      if (!context.sourceProfile || !context.targetProfile) {
        return undefined;
      }
      const bc = bhattacharyyaAgreement({
        referencedValueCounts: context.targetProfile.valueCounts,
        dependentValueCounts: context.sourceProfile.valueCounts,
      });
      return bc === undefined ? undefined : bc >= DISTRIBUTION_AGREEMENT_MIN_BC;
    },
  },
  {
    name: NAME_SIMILARITY_SIGNAL,
    m: 0.6,
    uSeed: 0.05,
    evaluate: context =>
      nameSimilarity({
        dependentFieldPath: context.sourceField,
        referencedFieldPath: context.targetField,
        referencedContainerName: context.referencedContainerName,
        idf: context.idf,
      }) >= NAME_SIMILARITY_MIN,
  },
  {
    name: 'type-agreement',
    m: 0.95,
    uSeed: 0.5,
    evaluate: context => {
      if (!context.sourceProfile || !context.targetProfile) {
        return undefined;
      }
      return (
        context.sourceProfile.dominantValueType ===
          context.targetProfile.dominantValueType &&
        context.sourceProfile.dominantValueType !== 'other'
      );
    },
  },
  {
    name: VALUE_RARITY_SIGNAL,
    m: 0.8,
    uSeed: 0.3,
    evaluate: context => {
      if (
        context.matchedValueCounts.size === 0 ||
        !context.referencedValueCounts
      ) {
        return undefined;
      }
      const referencedValueCounts = context.referencedValueCounts;
      const frequencies = [...context.matchedValueCounts.keys()].map(
        value => referencedValueCounts[`${value}`] ?? 1,
      );
      return median(frequencies) <= 2;
    },
  },
  {
    name: KEY_KEY_PENALTY_SIGNAL,
    m: 0.05,
    uSeed: 0.3,
    // Base condition only — "AND name-similarity did not fire" is applied
    // by fsScoreCandidate's second pass, not here (evaluators stay pure).
    evaluate: context => {
      if (!context.sourceProfile || !context.targetProfile) {
        return undefined;
      }
      return (
        context.sourceProfile.cardinalityRatio >= 0.95 &&
        context.targetProfile.cardinalityRatio >= 0.95
      );
    },
  },
  {
    name: 'semantic-compatible',
    m: 0.5,
    uSeed: 0.1,
    evaluate: context => {
      const compatibility = semanticCompatibilityFor(context);
      return compatibility === undefined
        ? undefined
        : compatibility === 'same-domain' || compatibility === 'related-domain';
    },
  },
  {
    name: 'semantic-incompatible',
    m: 0.02,
    uSeed: 0.2,
    evaluate: context => {
      const compatibility = semanticCompatibilityFor(context);
      return compatibility === undefined
        ? undefined
        : compatibility === 'mismatch';
    },
  },
  {
    name: FAN_OUT_SANITY_SIGNAL,
    m: 0.05,
    uSeed: 0.25,
    // Base condition only — "with common values" (i.e. AND value-rarity did
    // not fire) is applied by fsScoreCandidate's second pass, not here.
    evaluate: context => {
      if (
        context.matchedValueCounts.size === 0 ||
        !context.referencedValueCounts
      ) {
        return undefined;
      }
      const referencedValueCounts = context.referencedValueCounts;
      // Estimated edges = Σ (dependent rows with value) × (referenced rows
      // with value). The dependent frequency is the DEPENDENT side's corpus
      // count — context.sourceProfile is already the dependent side (swapped
      // with containment direction). matchedValueCounts only supplies the SET
      // of matched values: its counts are accumulator search hits on the
      // referenced side, so using them as the dependent frequency squared the
      // referenced count and flipped the estimate with direction.
      const dependentValueCounts = context.sourceProfile?.valueCounts;
      let expectedEdges = 0;
      for (const value of context.matchedValueCounts.keys()) {
        const dependentCount = dependentValueCounts?.[`${value}`] ?? 1;
        const referencedCount = referencedValueCounts[`${value}`] ?? 1;
        expectedEdges += dependentCount * referencedCount;
      }
      expectedEdges *= context.referencedSampleScale;
      return (
        expectedEdges >
        FAN_OUT_SANITY_MAX * Math.max(1, context.matchedValueCounts.size)
      );
    },
  },
  {
    name: 'hierarchy-context',
    m: 0.3,
    uSeed: 0.45,
    // Never skips: the dependent field path is always known for a candidate.
    evaluate: context => hasHierarchyContextSegment(context.sourceField),
    // measureU's random cross-datasource pairs are overwhelmingly non-parent-
    // ish fields, so the measured u lands far below the seeded 0.45 — that
    // would invert this signal's mild -0.585 fired penalty into a +2..+6
    // boost and levy a heavy penalty on every ordinary non-fired candidate.
    // The seed is a deliberate, hand-picked calibration; always use it.
    fixedU: true,
  },
];

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveU(
  signal: Pick<SignalDefinition, 'name' | 'uSeed'>,
  uBySignal?: Map<string, number>,
): number {
  return clamp(uBySignal?.get(signal.name) ?? signal.uSeed, U_FLOOR, 0.95);
}

function signalWeight(m: number, u: number, fired: boolean): number {
  return fired ? Math.log2(m / u) : Math.log2((1 - m) / (1 - u));
}

interface ScoredEntry {
  signal: string;
  fired: boolean;
  rawWeight: number;
  detail?: string;
}

function scoreContainmentGroup(
  context: SignalContext,
  uBySignal: Map<string, number> | undefined,
): ScoredEntry {
  const [containment99, containment95, containment85] = SIGNAL_TABLE;
  const group = [containment99, containment95, containment85];
  const detail = `containment ${context.containment.toFixed(2)}`;

  const firedLevel = group.find(signal => signal.evaluate(context) === true);
  if (firedLevel) {
    return {
      signal: firedLevel.name,
      fired: true,
      rawWeight: signalWeight(
        firedLevel.m,
        resolveU(firedLevel, uBySignal),
        true,
      ),
      detail,
    };
  }

  // Reached by u-estimation's random pairs (mostly < 0.85) and by
  // person_name_alias gate survivors, whose relaxed floor (0.5) admits honest
  // partial coverage — the whole group then contributes one non-firing term
  // per the plan's binding design, not three independent non-firing terms.
  // That negative term is what lets a fuller-coverage rule outrank a partial
  // alias match instead of both saturating at the top bucket.
  const groupU = Math.min(
    0.95,
    group.reduce((sum, signal) => sum + resolveU(signal, uBySignal), 0),
  );
  return {
    signal: 'containment',
    fired: false,
    rawWeight: signalWeight(0.95, groupU, false),
    detail,
  };
}

function buildNameSimilarityDetail(context: SignalContext): string {
  const target = context.referencedContainerName
    ? `${context.referencedContainerName}.${context.targetField}`
    : context.targetField;
  return `name ${context.sourceField}↔${target}`;
}

function formatSignedWeight(weight: number): string {
  const magnitude = Math.abs(weight).toFixed(2);
  return weight < 0 ? `−${magnitude}` : `+${magnitude}`;
}

function buildExplanation(
  waterfall: WaterfallEntry[],
  probability: number,
): string {
  const prior = waterfall.find(entry => entry.signal === 'prior');
  const others = waterfall.filter(entry => entry.signal !== 'prior');
  const topOthers = [...others]
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 3);
  const ordered = prior ? [...topOthers, prior] : topOthers;
  const fragments = ordered.map(
    entry =>
      `${entry.detail ?? entry.signal} (${formatSignedWeight(entry.weight)})`,
  );
  return `${fragments.join(', ')} → p=${probability.toFixed(2)}`;
}

function bandFor(probability: number): FsScore['band'] {
  if (probability >= HIGH_BAND_MIN_P) {
    return 'high';
  }
  return probability >= MEDIUM_BAND_MIN_P ? 'medium' : 'low';
}

export function fsScoreCandidate(
  context: SignalContext,
  uBySignal?: Map<string, number>, // measured u overrides (Task 4)
  calibration?: ScoreCalibration,
): FsScore {
  const [, , , ...restSignals] = SIGNAL_TABLE;

  // First pass: raw per-signal firing, unaware of cross-signal dependencies.
  const rawFired = new Map<string, SignalFired>();
  for (const signal of restSignals) {
    rawFired.set(signal.name, signal.evaluate(context));
  }

  // Second pass: apply the two documented dependencies. Each `evaluate`
  // stays pure (a function of `context` alone); only fsScoreCandidate knows
  // about another signal's outcome.
  if (
    rawFired.get(KEY_KEY_PENALTY_SIGNAL) === true &&
    rawFired.get(NAME_SIMILARITY_SIGNAL) === true
  ) {
    rawFired.set(KEY_KEY_PENALTY_SIGNAL, false);
  }
  if (
    rawFired.get(FAN_OUT_SANITY_SIGNAL) === true &&
    rawFired.get(VALUE_RARITY_SIGNAL) === true
  ) {
    rawFired.set(FAN_OUT_SANITY_SIGNAL, false);
  }

  const entries: ScoredEntry[] = [
    { signal: 'prior', fired: true, rawWeight: PRIOR_LOG_ODDS },
    scoreContainmentGroup(context, uBySignal),
  ];
  for (const signal of restSignals) {
    const fired = rawFired.get(signal.name);
    if (fired === undefined) {
      continue;
    }
    entries.push({
      signal: signal.name,
      fired,
      rawWeight: signalWeight(signal.m, resolveU(signal, uBySignal), fired),
      ...(signal.name === NAME_SIMILARITY_SIGNAL
        ? { detail: buildNameSimilarityDetail(context) }
        : {}),
    });
  }

  const rawLogOdds = entries.reduce((sum, entry) => sum + entry.rawWeight, 0);
  const effectiveLogOdds = calibration
    ? applyCalibration(rawLogOdds, calibration)
    : rawLogOdds;
  const probability = round(1 / (1 + 2 ** -effectiveLogOdds), 4);
  const logOdds = round(effectiveLogOdds, 4);
  const waterfall: WaterfallEntry[] = entries.map(entry => ({
    signal: entry.signal,
    fired: entry.fired,
    weight: round(entry.rawWeight, 3),
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
  }));

  return {
    probability,
    logOdds,
    band: bandFor(probability),
    waterfall,
    explanation: buildExplanation(waterfall, probability),
  };
}
