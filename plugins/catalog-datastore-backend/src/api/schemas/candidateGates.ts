import type { FieldProfile } from './field-profiling';
import { classifyRelationshipCandidateValue } from './relationshipCandidateFilter';

export const CONTAINMENT_GATE_THRESHOLD = 0.85;
/**
 * Relaxed containment floor for `person_name_alias` candidates. People
 * legitimately exist in one tool and not the other, so partial coverage is the
 * expected shape of a real people-join — and the product supports manual
 * relationships covering the remainder, so a 73%-coverage alias rule plus
 * hand-linked stragglers is a first-class outcome. The honest (sub-0.85)
 * containment still feeds the score, so a fuller-coverage alternative outranks
 * a partial one.
 */
export const ALIAS_CONTAINMENT_GATE_THRESHOLD = 0.5;
export const KEYNESS_GATE_THRESHOLD = 0.95;
export const TRIVIAL_DOMAIN_MIN_DISTINCT = 3;
export const MIN_MATCH_SUPPORT = 3;
export const TINY_ENUM_MAX_DISTINCT = 5;
export const TINY_ENUM_TOP_SHARE = 0.5;
export const VERIFICATION_VALUE_CAP = 200;
export const VERIFICATION_CONTAINMENT_FLOOR = 0.5;

export type GateFailureReason =
  | 'identity-mirror'
  | 'trivial-domain'
  | 'containment-below-threshold'
  | 'referenced-not-key-like'
  | 'counter-collision'
  | 'insufficient-match-support';

export type GateRescueHint = 'try-filter' | 'try-transform';

export interface GateEvidence {
  containment: number;
  containmentDirection: 'source-to-target' | 'target-to-source';
  containmentVerified: boolean;
  referencedCardinalityRatio: number;
  dependentDistinctCount: number;
}

export type GateResult =
  | { passed: true; evidence: GateEvidence }
  | {
      passed: false;
      reason: GateFailureReason;
      evidence: Partial<GateEvidence>;
      rescueHint?: GateRescueHint;
    };

export interface GateCandidate {
  sourceField: string;
  targetField: string;
  /** data.valueCounts.size from the match accumulator — distinct dependent
   * values with any match evidence (exact, alias, fuzzy, contains). */
  distinctMatchedValueCount: number;
  /**
   * The matched values themselves (the accumulator's valueCounts keys). Alias
   * searches record every matched alias VARIANT as its own value, so the raw
   * count can exceed the source's distinct count (a live rule showed 23
   * "matched values" over 11 source names → containment 2.09). When present,
   * coverage counts only matched values that exist in the source's eligible
   * set, keeping containment an honest fraction.
   */
  matchedValues?: readonly string[];
  /**
   * The suggestion's match strategy. Two gates read it: `array_contains` is a
   * membership join, so key-ness must be checked on the scalar side rather than
   * whichever side containment favoured; `person_name_alias` candidates get a
   * relaxed containment floor (see ALIAS_CONTAINMENT_GATE_THRESHOLD).
   */
  matchStrategy?: string;
  sourceProfile?: FieldProfile;
  targetProfile?: FieldProfile;
}

export interface GateContext {
  /** True when the target corpus is a partial sample (total > items). */
  targetCorpusPartial: boolean;
  /** Full-table presence check for containment verification; absent in
   * pure-unit contexts. Receives at most VERIFICATION_VALUE_CAP values. */
  verifyValuesPresent?: (values: string[]) => Promise<Set<string>>;
}

type ContainmentDirection = 'source-to-target' | 'target-to-source';

const BOOLEAN_LIKE_VALUES = new Set([
  'true',
  'false',
  'yes',
  'no',
  'y',
  'n',
  '0',
  '1',
]);

const INTEGER_PATTERN = /^\d+$/;

// Moved verbatim from field-match-builder.ts: field paths arrive prefixed
// (e.g. `$.id`) so both the raw and JSONata-prefixed spellings are checked.
function isIdField(path: string): boolean {
  return path === 'id' || path === '$.id' || path === '$.$.id';
}

function eligibleValues(profile: FieldProfile | undefined): Set<string> {
  const eligible = new Set<string>();
  if (!profile) {
    return eligible;
  }
  for (const value of Object.keys(profile.valueCounts)) {
    if (classifyRelationshipCandidateValue(value) !== null) {
      eligible.add(value);
    }
  }
  return eligible;
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const value of a) {
    if (b.has(value)) {
      count += 1;
    }
  }
  return count;
}

function parsedInts(values: Iterable<string>): number[] {
  const ints: number[] = [];
  for (const value of values) {
    if (INTEGER_PATTERN.test(value)) {
      ints.push(parseInt(value, 10));
    }
  }
  return ints;
}

function checkTrivialDomain(
  sourceProfile: FieldProfile | undefined,
): GateResult | null {
  const eligible = eligibleValues(sourceProfile);
  if (eligible.size < TRIVIAL_DOMAIN_MIN_DISTINCT) {
    return { passed: false, reason: 'trivial-domain', evidence: {} };
  }

  const isBooleanLike = [...eligible].every(value =>
    BOOLEAN_LIKE_VALUES.has(value.toLowerCase()),
  );
  if (isBooleanLike) {
    return { passed: false, reason: 'trivial-domain', evidence: {} };
  }

  if (eligible.size <= TINY_ENUM_MAX_DISTINCT) {
    // rowsWithAnyValue isn't on the profile; approximate the denominator with
    // sum(valueCounts) over the full (not just eligible) value distribution.
    const counts = Object.values(sourceProfile?.valueCounts ?? {});
    const total = counts.reduce((sum, count) => sum + count, 0);
    // reduce, not Math.max(...counts) — a wide field's eligible set can
    // exceed V8's spread-argument limit over a 1000-row sample.
    const maxCount = counts.reduce((max, count) => Math.max(max, count), 0);
    const topShare = total === 0 ? 0 : maxCount / total;
    if (topShare >= TINY_ENUM_TOP_SHARE) {
      return {
        passed: false,
        reason: 'trivial-domain',
        evidence: {},
        rescueHint: 'try-filter',
      };
    }
  }

  return null;
}

interface ContainmentOutcome {
  best: number;
  direction: ContainmentDirection;
  verified: boolean;
  /** Extra source values staged verification confirmed on the full target
   *  table (beyond the in-sample intersection). Feeds the match-support gate so
   *  a small-key source vs a partial target sample isn't suppressed as
   *  insufficient-support after verification already rescued its containment. */
  verifiedCount: number;
}

async function checkContainment(
  candidate: GateCandidate,
  context: GateContext,
  sourceEligible: Set<string>,
  targetEligible: Set<string>,
): Promise<
  | { failed: true; result: GateResult }
  | ({ failed: false } & ContainmentOutcome)
> {
  const intersection = intersectionSize(sourceEligible, targetEligible);
  const s2tRaw =
    sourceEligible.size === 0 ? 0 : intersection / sourceEligible.size;
  const t2s =
    targetEligible.size === 0 ? 0 : intersection / targetEligible.size;
  const coverage =
    sourceEligible.size === 0
      ? 0
      : matchedInSourceCount(candidate, sourceEligible) / sourceEligible.size;

  let best = Math.max(s2tRaw, coverage);
  let direction: ContainmentDirection = 'source-to-target';
  if (t2s > best) {
    direction = 'target-to-source';
    best = t2s;
  }

  let verified = false;
  let verifiedCount = 0;
  if (
    best < CONTAINMENT_GATE_THRESHOLD &&
    direction === 'source-to-target' &&
    context.targetCorpusPartial &&
    context.verifyValuesPresent &&
    best >= VERIFICATION_CONTAINMENT_FLOOR
  ) {
    const missing = [...sourceEligible]
      .filter(value => !targetEligible.has(value))
      .sort()
      .slice(0, VERIFICATION_VALUE_CAP);
    const verifiedPresent = await context.verifyValuesPresent(missing);
    verifiedCount = verifiedPresent.size;
    const recomputedS2t = (intersection + verifiedCount) / sourceEligible.size;
    verified = recomputedS2t >= CONTAINMENT_GATE_THRESHOLD;
    best = Math.max(best, recomputedS2t);
  }

  // People legitimately exist in one tool and not the other, and manual
  // relationships cover the remainder — so alias candidates gate on a relaxed
  // floor while their honest partial containment still lowers the score.
  const gateThreshold =
    candidate.matchStrategy === 'person_name_alias'
      ? ALIAS_CONTAINMENT_GATE_THRESHOLD
      : CONTAINMENT_GATE_THRESHOLD;
  if (best < gateThreshold) {
    const bothIdentifierLike =
      candidate.sourceProfile?.isIdentifierLike === true &&
      candidate.targetProfile?.isIdentifierLike === true;
    return {
      failed: true,
      result: {
        passed: false,
        reason: 'containment-below-threshold',
        evidence: {
          containment: best,
          containmentDirection: direction,
          containmentVerified: verified,
        },
        ...(bothIdentifierLike ? { rescueHint: 'try-transform' as const } : {}),
      },
    };
  }

  return { failed: false, best, direction, verified, verifiedCount };
}

/**
 * Distinct matched values that actually exist in the source's eligible set.
 * Alias searches record every matched VARIANT as its own value, so the raw
 * accumulator count can exceed the source's distinct count; intersecting keeps
 * coverage an honest ≤ 1 fraction. Without the values (re-gate paths), fall
 * back to the raw count clamped to the domain size.
 */
function matchedInSourceCount(
  candidate: GateCandidate,
  sourceEligible: Set<string>,
): number {
  if (candidate.matchedValues) {
    let count = 0;
    for (const value of candidate.matchedValues) {
      if (sourceEligible.has(value)) {
        count += 1;
      }
    }
    return count;
  }
  return Math.min(candidate.distinctMatchedValueCount, sourceEligible.size);
}

function referencedProfileFor(
  candidate: GateCandidate,
  direction: ContainmentDirection,
): FieldProfile | undefined {
  // An array_contains membership join always references the scalar side (a
  // scalar key appears as an element of the other side's array), so key-ness
  // belongs on the scalar profile regardless of which way containment tipped.
  // The builder lays these out as scalar-source → array-target, but resolve
  // by valueContainer so an unexpected ordering can't point key-ness at the
  // array — an array is never unique per row and would fail referenced-not-
  // key-like for a legitimate join.
  if (candidate.matchStrategy === 'array_contains') {
    return candidate.sourceProfile?.valueContainer === 'array'
      ? candidate.targetProfile
      : candidate.sourceProfile;
  }
  return direction === 'source-to-target'
    ? candidate.targetProfile
    : candidate.sourceProfile;
}

function checkKeyness(
  candidate: GateCandidate,
  direction: ContainmentDirection,
): GateResult | null {
  const referencedCardinalityRatio =
    referencedProfileFor(candidate, direction)?.cardinalityRatio ?? 0;
  if (referencedCardinalityRatio < KEYNESS_GATE_THRESHOLD) {
    return {
      passed: false,
      reason: 'referenced-not-key-like',
      evidence: { referencedCardinalityRatio },
    };
  }
  return null;
}

function checkCounterCollision(
  candidate: GateCandidate,
  direction: ContainmentDirection,
  sourceEligible: Set<string>,
  targetEligible: Set<string>,
): GateResult | null {
  const fracSource =
    sourceEligible.size === 0
      ? 0
      : parsedInts(sourceEligible).length / sourceEligible.size;
  const fracTarget =
    targetEligible.size === 0
      ? 0
      : parsedInts(targetEligible).length / targetEligible.size;
  if (fracSource < 0.8 || fracTarget < 0.8) {
    return null;
  }

  // The collision this gate exists to catch is two independent auto-increment
  // counters whose ranges coincidentally overlap — both sides are unique
  // serials. A real many-to-one integer FK to a serial key has the SAME dense
  // referenced range and the same within-range dependents, so range tests
  // alone can't tell them apart; the tell is that a foreign key repeats its
  // referenced values (many rows point to one key) while a counter does not.
  // Require the dependent side to itself be near-unique before suppressing, or
  // legitimate FKs are gated as counter-collisions after passing containment
  // and key-ness.
  const dependentProfile =
    direction === 'source-to-target'
      ? candidate.sourceProfile
      : candidate.targetProfile;
  const dependentCardinalityRatio = dependentProfile?.cardinalityRatio ?? 1;
  if (dependentCardinalityRatio < KEYNESS_GATE_THRESHOLD) {
    return null;
  }

  const referencedEligible =
    direction === 'source-to-target' ? targetEligible : sourceEligible;
  const dependentEligible =
    direction === 'source-to-target' ? sourceEligible : targetEligible;
  const referencedInts = parsedInts(referencedEligible);
  const distinctReferenced = new Set(referencedInts).size;
  if (distinctReferenced < 10) {
    return null;
  }

  // reduce, not Math.min/max(...referencedInts) — a wide numeric-id field
  // can exceed V8's spread-argument limit over a 1000-row sample.
  const min = referencedInts.reduce(
    (acc, value) => Math.min(acc, value),
    referencedInts[0],
  );
  const max = referencedInts.reduce(
    (acc, value) => Math.max(acc, value),
    referencedInts[0],
  );
  const isDense = distinctReferenced / (max - min + 1) >= 0.8;
  if (!isDense) {
    return null;
  }

  const dependentInts = parsedInts(dependentEligible);
  const allDependentWithinRange = dependentInts.every(
    value => value >= min && value <= max,
  );
  if (allDependentWithinRange) {
    return { passed: false, reason: 'counter-collision', evidence: {} };
  }
  return null;
}

/**
 * The mirror of `trivial-domain` for the CONTAINED side. Containment can reach
 * 1.0 through a degenerate domain — e.g. a repo `topics` array vs a namespace
 * `finalizers` array whose only value everywhere is the literal `kubernetes`:
 * the 1-value target domain is fully contained in the source, the t2s direction
 * fires, and keyness only tests the *referenced* side, so nothing catches that
 * the whole relationship rests on ONE shared value. Require the match to be
 * supported by at least MIN_MATCH_SUPPORT distinct values (domain intersection
 * or accumulator evidence, whichever is larger — alias/fuzzy matches can have
 * an empty literal intersection).
 *
 * Exempt genuinely tiny corpora: a 1-row datasource (an org, a cluster) can
 * only ever produce one match, and that IS all the evidence there could be —
 * FS scoring judges those on rarity instead.
 */
function checkMatchSupport(
  candidate: GateCandidate,
  intersection: number,
  sourceEligible: Set<string>,
  verifiedCount: number,
): GateResult | null {
  const sourceRows = candidate.sourceProfile?.rowCount;
  const targetRows = candidate.targetProfile?.rowCount;
  if (sourceRows === undefined || targetRows === undefined) {
    return null;
  }
  if (Math.min(sourceRows, targetRows) < MIN_MATCH_SUPPORT) {
    return null;
  }
  // Count values staged verification confirmed on the full target too: a small
  // key source vs a partial target sample is exactly what verification rescues,
  // and its containment already passed — the support gate must not then suppress
  // it for values that were merely absent from the target SAMPLE.
  const support = Math.max(
    intersection + verifiedCount,
    matchedInSourceCount(candidate, sourceEligible),
  );
  if (support < MIN_MATCH_SUPPORT) {
    return {
      passed: false,
      reason: 'insufficient-match-support',
      evidence: {},
    };
  }
  return null;
}

export async function applyCandidateGates(
  candidate: GateCandidate,
  context: GateContext,
): Promise<GateResult> {
  if (isIdField(candidate.sourceField) && isIdField(candidate.targetField)) {
    return { passed: false, reason: 'identity-mirror', evidence: {} };
  }

  const trivialDomainResult = checkTrivialDomain(candidate.sourceProfile);
  if (trivialDomainResult) {
    return trivialDomainResult;
  }

  const sourceEligible = eligibleValues(candidate.sourceProfile);
  const targetEligible = eligibleValues(candidate.targetProfile);

  const containmentOutcome = await checkContainment(
    candidate,
    context,
    sourceEligible,
    targetEligible,
  );
  if (containmentOutcome.failed) {
    return containmentOutcome.result;
  }
  const { best, direction, verified, verifiedCount } = containmentOutcome;

  const keynessResult = checkKeyness(candidate, direction);
  if (keynessResult) {
    return keynessResult;
  }

  const counterCollisionResult = checkCounterCollision(
    candidate,
    direction,
    sourceEligible,
    targetEligible,
  );
  if (counterCollisionResult) {
    return counterCollisionResult;
  }

  const matchSupportResult = checkMatchSupport(
    candidate,
    intersectionSize(sourceEligible, targetEligible),
    sourceEligible,
    verifiedCount,
  );
  if (matchSupportResult) {
    return matchSupportResult;
  }

  const dependentDistinctCount =
    direction === 'source-to-target'
      ? sourceEligible.size
      : targetEligible.size;

  return {
    passed: true,
    evidence: {
      containment: best,
      containmentDirection: direction,
      containmentVerified: verified,
      referencedCardinalityRatio:
        referencedProfileFor(candidate, direction)?.cardinalityRatio ?? 0,
      dependentDistinctCount,
    },
  };
}
