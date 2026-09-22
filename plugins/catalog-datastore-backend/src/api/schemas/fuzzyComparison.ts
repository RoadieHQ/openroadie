import type { RelationshipSuggestionValueType } from '@roadiehq/catalog-datastore-common';

const JARO_PREFIX_SCALE = 0.1;
const JARO_PREFIX_MAX = 4;

/**
 * Jaro-Winkler similarity in [0, 1]. 1 means identical strings; 0 means no
 * common characters. The implementation follows the standard reference:
 * Jaro similarity boosted by a fixed prefix scale up to 4 leading characters.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  if (a.length === 0 || b.length === 0) {
    return 0;
  }

  const matchWindow = Math.max(
    0,
    Math.floor(Math.max(a.length, b.length) / 2) - 1,
  );
  const aMatches = new Array<boolean>(a.length).fill(false);
  const bMatches = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(b.length, i + matchWindow + 1);
    for (let j = start; j < end; j += 1) {
      if (bMatches[j] || a[i] !== b[j]) {
        continue;
      }
      aMatches[i] = true;
      bMatches[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) {
    return 0;
  }

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatches[i]) {
      continue;
    }
    while (!bMatches[k]) {
      k += 1;
    }
    if (a[i] !== b[k]) {
      transpositions += 1;
    }
    k += 1;
  }

  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;

  let prefix = 0;
  const prefixCap = Math.min(JARO_PREFIX_MAX, a.length, b.length);
  for (let i = 0; i < prefixCap; i += 1) {
    if (a[i] === b[i]) {
      prefix += 1;
    } else {
      break;
    }
  }

  return jaro + prefix * JARO_PREFIX_SCALE * (1 - jaro);
}

/**
 * Token-set ratio: split both strings on non-alphanumeric boundaries, lowercase
 * the tokens, and return the Jaccard similarity of the resulting token sets.
 * Useful for slug-like values where order or delimiter style differs but the
 * underlying tokens are the same (e.g. `payment-svc` vs `payment_service`).
 */
export function tokenSetRatio(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 && tokensB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection += 1;
    }
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(token => token.length > 0),
  );
}

/**
 * Threshold for treating two values as fuzzy-equivalent, by dominant type.
 * `null` means fuzzy comparison is disabled for that type. Thresholds are
 * tuned to favour precision over recall: borderline matches stay rejected.
 */
const FUZZY_THRESHOLDS: Partial<
  Record<
    RelationshipSuggestionValueType,
    { method: 'jaroWinkler' | 'tokenSet'; threshold: number }
  >
> = {
  person_name: { method: 'jaroWinkler', threshold: 0.92 },
  handle: { method: 'jaroWinkler', threshold: 0.94 },
  slug: { method: 'tokenSet', threshold: 0.9 },
};

/**
 * Returns a similarity score in (0, 1] when the two values are deemed
 * fuzzy-equivalent for their dominant type, or `null` when they are not.
 * Exact matches return `null` — callers should detect those before invoking.
 */
export function fuzzySimilarity(
  a: string,
  b: string,
  type: RelationshipSuggestionValueType,
): number | null {
  if (a === b) {
    return null;
  }
  const config = FUZZY_THRESHOLDS[type];
  if (!config) {
    return null;
  }
  const score =
    config.method === 'jaroWinkler' ? jaroWinkler(a, b) : tokenSetRatio(a, b);
  return score >= config.threshold ? score : null;
}
