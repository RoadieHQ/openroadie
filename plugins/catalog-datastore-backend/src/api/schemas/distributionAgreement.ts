export const QUANTILE_BUCKET_COUNT = 20;

const NUMERIC_VALUE_PATTERN = /^-?\d+(\.\d+)?$/;

type Comparator = (a: string, b: string) => number;

function isNumericValue(value: string): boolean {
  return NUMERIC_VALUE_PATTERN.test(value);
}

// Plain codepoint comparison, not localeCompare(..., { numeric: true }) —
// this must be stable across ICU versions/environments.
function lexicographicCompare(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

function buildComparator(
  referencedValues: string[],
  dependentValues: string[],
): Comparator {
  const allNumeric =
    referencedValues.every(isNumericValue) &&
    dependentValues.every(isNumericValue);
  if (allNumeric) {
    return (a, b) => parseFloat(a) - parseFloat(b);
  }
  return lexicographicCompare;
}

/**
 * Splits `counts` (aligned to the sorted referenced values) into
 * `bucketCount` contiguous runs of near-equal cumulative mass. Returns
 * `bucketCount + 1` segment-boundary indices into `counts`
 * (`[0, ..., counts.length]`); bucket `b` spans `[boundaries[b], boundaries[b+1])`.
 * Each segment gets at least one element, which is always possible because
 * callers only invoke this when `counts.length >= bucketCount`.
 */
function computeBucketBoundaries(
  counts: number[],
  bucketCount: number,
): number[] {
  const n = counts.length;
  const cumulative = new Array<number>(n);
  let running = 0;
  for (let i = 0; i < n; i += 1) {
    running += counts[i];
    cumulative[i] = running;
  }
  const total = running;

  const boundaries = [0];
  let previousCut = 0;
  for (let bucket = 1; bucket < bucketCount; bucket += 1) {
    const target = (total * bucket) / bucketCount;

    // Smallest index whose cumulative mass reaches the target share.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cumulative[mid] >= target) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }

    let cut = lo + 1;
    const minCut = previousCut + 1; // leave the previous bucket non-empty
    const maxCut = n - (bucketCount - bucket); // leave >=1 value per remaining bucket
    if (cut < minCut) {
      cut = minCut;
    } else if (cut > maxCut) {
      cut = maxCut;
    }

    boundaries.push(cut);
    previousCut = cut;
  }
  boundaries.push(n);
  return boundaries;
}

/**
 * Returns the index of the bucket whose range contains `value`, via binary
 * search over `boundaryValues` (the maximum referenced value of every bucket
 * except the last). Values below the first boundary or above the last both
 * clamp naturally: search finds bucket 0 for anything <= the first boundary,
 * and falls through to `boundaryValues.length` (the last bucket index) for
 * anything greater than every boundary.
 */
function assignBucket(
  value: string,
  boundaryValues: string[],
  compare: Comparator,
): number {
  let lo = 0;
  let hi = boundaryValues.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compare(value, boundaryValues[mid]) <= 0) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

/**
 * Splits the referenced domain's sorted distinct values into up to
 * QUANTILE_BUCKET_COUNT equal-count buckets and returns the histogram of the
 * dependent values over those buckets, alongside the referenced histogram.
 * Values sort numerically when BOTH sides are fully numeric, else
 * lexicographically (plain codepoint sort, not localeCompare numeric mode —
 * for determinism across ICU versions).
 */
export function bhattacharyyaAgreement(params: {
  /** value -> occurrence count over the referenced field's corpus sample */
  referencedValueCounts: Record<string, number>;
  /** value -> occurrence count of the DEPENDENT side's matched/sample values */
  dependentValueCounts: Record<string, number>;
}): number | undefined {
  const referencedEntries = Object.entries(params.referencedValueCounts);
  const dependentEntries = Object.entries(params.dependentValueCounts);
  if (
    referencedEntries.length < QUANTILE_BUCKET_COUNT ||
    dependentEntries.length === 0
  ) {
    return undefined;
  }

  const compare = buildComparator(
    referencedEntries.map(([value]) => value),
    dependentEntries.map(([value]) => value),
  );

  const sortedReferenced = [...referencedEntries].sort((a, b) =>
    compare(a[0], b[0]),
  );
  const sortedValues = sortedReferenced.map(([value]) => value);
  const sortedCounts = sortedReferenced.map(([, count]) => count);

  const boundaries = computeBucketBoundaries(
    sortedCounts,
    QUANTILE_BUCKET_COUNT,
  );
  // The last value of every bucket except the last one, used to binary-search
  // the bucket for an arbitrary value.
  const boundaryValues = boundaries
    .slice(1, -1)
    .map(cut => sortedValues[cut - 1]);

  const referencedHistogram = new Array<number>(QUANTILE_BUCKET_COUNT).fill(0);
  for (let bucket = 0; bucket < QUANTILE_BUCKET_COUNT; bucket += 1) {
    let mass = 0;
    for (let i = boundaries[bucket]; i < boundaries[bucket + 1]; i += 1) {
      mass += sortedCounts[i];
    }
    referencedHistogram[bucket] = mass;
  }

  const dependentHistogram = new Array<number>(QUANTILE_BUCKET_COUNT).fill(0);
  for (const [value, count] of dependentEntries) {
    const bucket = assignBucket(value, boundaryValues, compare);
    dependentHistogram[bucket] += count;
  }

  // Non-empty inputs can still carry zero total mass (every count is 0, e.g.
  // an upstream tally that recorded a key with a 0 occurrence count) — that
  // can't be normalized into a probability vector, so skip rather than
  // divide by zero into NaN.
  const referencedTotal = referencedHistogram.reduce((sum, c) => sum + c, 0);
  const dependentTotal = dependentHistogram.reduce((sum, c) => sum + c, 0);
  if (referencedTotal === 0 || dependentTotal === 0) {
    return undefined;
  }

  let bhattacharyyaCoefficient = 0;
  for (let bucket = 0; bucket < QUANTILE_BUCKET_COUNT; bucket += 1) {
    const p = dependentHistogram[bucket] / dependentTotal;
    const q = referencedHistogram[bucket] / referencedTotal;
    bhattacharyyaCoefficient += Math.sqrt(p * q);
  }
  return bhattacharyyaCoefficient;
}
