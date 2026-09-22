import type { FieldProfile } from './field-profiling';
import { classifyRelationshipCandidateValue } from './relationshipCandidateFilter';
import { SIGNAL_TABLE, type SignalContext } from './signalScoring';

/** Random pairs drawn per Generate run to measure per-signal u empirically. */
export const RANDOM_PAIR_COUNT = 200;

// Low-diversity floor: below this many DISTINCT cross-datasource field-pairs
// actually sampled, every signal's empirical u is dominated by a handful of
// field pairs and collapses toward 0/1, misrepresenting its true
// false-positive rate for the whole run. When the sample is that thin we
// return no entries so each signal falls back to its hand-tuned `uSeed`
// (resolveU treats a missing entry as "use the seed"). Sits well below any
// real corpus's pair count, so healthy runs are never affected.
export const MIN_DISTINCT_SAMPLED_PAIRS = 4;

// Rejection sampling (different-datasource pairs only) can starve on a pool
// dominated by one datasource; capping attempts bounds the work instead of
// looping until exhaustion, at the cost of returning fewer than COUNT pairs.
const MAX_DRAW_ATTEMPTS_MULTIPLIER = 20;

export interface MeasureUCorpusInput {
  datasourceId: string;
  profilesByField: Record<string, FieldProfile>;
  containerName?: string;
}

export interface PoolEntry {
  datasourceId: string;
  fieldPath: string;
  profile: FieldProfile;
  containerName?: string;
}

export interface FieldPair {
  i: PoolEntry;
  j: PoolEntry;
}

// FNV-1a, 32-bit.
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// mulberry32: small, fast, deterministic 32-bit PRNG — no Math.random/Date,
// so a run's random pairs (and thus its measured u) are reproducible from
// the same corpora.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromDatasourceIds(datasourceIds: Iterable<string>): number {
  return fnv1a([...datasourceIds].sort().join('\0'));
}

function buildPool(corpora: MeasureUCorpusInput[]): PoolEntry[] {
  const pool: PoolEntry[] = [];
  for (const corpus of corpora) {
    for (const [fieldPath, profile] of Object.entries(corpus.profilesByField)) {
      pool.push({
        datasourceId: corpus.datasourceId,
        fieldPath,
        profile,
        containerName: corpus.containerName,
      });
    }
  }
  // Codepoint comparison, not localeCompare: the pool order feeds the PRNG's
  // pair selection, so ICU/locale-dependent collation would change measured u
  // (and therefore persisted scores) across Node upgrades.
  const codepointCompare = (a: string, b: string): number =>
    a < b ? -1 : a > b ? 1 : 0;
  return pool.sort((a, b) => {
    const byDatasource = codepointCompare(a.datasourceId, b.datasourceId);
    return byDatasource !== 0
      ? byDatasource
      : codepointCompare(a.fieldPath, b.fieldPath);
  });
}

/**
 * Draws `count` (i, j) pairs from `pool` with `i.datasourceId !==
 * j.datasourceId`, via rejection sampling on `random`. Exposed for direct
 * testing of the no-same-datasource-pair invariant.
 */
export function drawPairs(params: {
  pool: PoolEntry[];
  random: () => number;
  count?: number;
}): FieldPair[] {
  const { pool, random } = params;
  const count = params.count ?? RANDOM_PAIR_COUNT;
  const pairs: FieldPair[] = [];
  if (pool.length < 2) {
    return pairs;
  }

  const maxAttempts = count * MAX_DRAW_ATTEMPTS_MULTIPLIER;
  let attempts = 0;
  while (pairs.length < count && attempts < maxAttempts) {
    attempts += 1;
    const i = pool[Number(Math.floor(random() * pool.length))];
    const j = pool[Number(Math.floor(random() * pool.length))];
    if (i.datasourceId === j.datasourceId) {
      continue;
    }
    pairs.push({ i, j });
  }
  return pairs;
}

// Same eligible-values + intersection math as candidateGates' local gate
// helpers, reimplemented here per the brief (candidateGates exports no
// reusable helper) — eligible = valueCounts keys that classify non-null.
function eligibleValues(profile: FieldProfile): Set<string> {
  const eligible = new Set<string>();
  for (const value of Object.keys(profile.valueCounts)) {
    if (classifyRelationshipCandidateValue(value) !== null) {
      eligible.add(value);
    }
  }
  return eligible;
}

function eligibleIntersection(
  source: FieldProfile,
  target: FieldProfile,
): { matched: Set<string>; sourceEligibleSize: number } {
  const sourceEligible = eligibleValues(source);
  const targetEligible = eligibleValues(target);
  const matched = new Set<string>();
  for (const value of sourceEligible) {
    if (targetEligible.has(value)) {
      matched.add(value);
    }
  }
  return { matched, sourceEligibleSize: sourceEligible.size };
}

function buildPairContext(
  pair: FieldPair,
  idf: Map<string, number>,
): SignalContext {
  const { i, j } = pair;
  const { matched, sourceEligibleSize } = eligibleIntersection(
    i.profile,
    j.profile,
  );
  // Populate matchedValueCounts with the intersected values so value-rarity
  // and fan-out-sanity actually evaluate on random pairs (both skip on an
  // empty map) and measureU records a per-tenant u for them instead of
  // falling back to uSeed. Those signals read only the value SET here — the
  // count is a placeholder (real scoring uses accumulator counts).
  const matchedValueCounts = new Map<string, number>(
    [...matched].map(value => [value, 1]),
  );
  return {
    sourceField: i.fieldPath,
    targetField: j.fieldPath,
    sourceProfile: i.profile,
    targetProfile: j.profile,
    containment:
      sourceEligibleSize === 0 ? 0 : matched.size / sourceEligibleSize,
    matchedValueCounts,
    referencedValueCounts: j.profile.valueCounts,
    idf,
    referencedContainerName: j.containerName,
    referencedSampleScale: 1,
  };
}

/**
 * Label-free per-run measurement of each signal's u (false-positive rate)
 * from random cross-datasource field pairs — an empirical stand-in for the
 * hand-picked `uSeed` on `SIGNAL_TABLE`. Deterministic: the PRNG is seeded
 * via FNV-1a over the sorted datasource ids, so the same corpora always
 * produce the same pairs and the same u. Returns raw fractions — the
 * consumer (`fsScoreCandidate`) applies `U_FLOOR`/the cap.
 */
export function measureU(params: {
  corpora: MeasureUCorpusInput[];
  idf: Map<string, number>;
}): Map<string, number> {
  const datasourceIds = new Set(
    params.corpora.map(corpus => corpus.datasourceId),
  );
  if (datasourceIds.size < 2) {
    return new Map();
  }

  const pool = buildPool(params.corpora);
  if (pool.length === 0) {
    return new Map();
  }

  const random = mulberry32(seedFromDatasourceIds(datasourceIds));
  const pairs = drawPairs({ pool, random, count: RANDOM_PAIR_COUNT });

  // Guard against a degenerate, low-diversity sample (see
  // MIN_DISTINCT_SAMPLED_PAIRS): count the DISTINCT field-pairs drawn, not the
  // raw draw count — rejection sampling can return 200 draws that are really
  // the same two or three pairs repeated when the pool has very few fields.
  const distinctPairs = new Set(
    pairs.map(
      pair =>
        `${pair.i.datasourceId}:${pair.i.fieldPath}\u0000${pair.j.datasourceId}:${pair.j.fieldPath}`,
    ),
  );
  if (distinctPairs.size < MIN_DISTINCT_SAMPLED_PAIRS) {
    return new Map();
  }

  const evaluatedCounts = new Map<string, number>();
  const firedCounts = new Map<string, number>();
  for (const pair of pairs) {
    const context = buildPairContext(pair, params.idf);
    for (const signal of SIGNAL_TABLE) {
      // fixedU signals never get a map entry — resolveU then falls through
      // to their uSeed naturally (see SignalDefinition.fixedU's doc comment).
      if (signal.fixedU) {
        continue;
      }
      const fired = signal.evaluate(context);
      if (fired === undefined) {
        continue;
      }
      evaluatedCounts.set(
        signal.name,
        (evaluatedCounts.get(signal.name) ?? 0) + 1,
      );
      if (fired) {
        firedCounts.set(signal.name, (firedCounts.get(signal.name) ?? 0) + 1);
      }
    }
  }

  const u = new Map<string, number>();
  for (const [name, evaluated] of evaluatedCounts) {
    u.set(name, (firedCounts.get(name) ?? 0) / evaluated);
  }
  return u;
}
