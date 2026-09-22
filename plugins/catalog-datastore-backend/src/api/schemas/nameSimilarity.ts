/**
 * Threshold above which the name-similarity signal counts as corroborating
 * evidence for a candidate relationship (Task 5's scoring engine).
 */
export const NAME_SIMILARITY_MIN = 0.5;

// A dependent token with no idf entry (never seen in the run's corpora) is
// treated as an ordinary token rather than infinitely rare or worthless —
// this mirrors the "generic token" baseline documented on buildTokenIdf.
const GENERIC_FALLBACK_IDF = 1;

const CAMEL_HUMP_ACRONYM = /([A-Z]+)([A-Z][a-z])/g;
const CAMEL_HUMP_BOUNDARY = /([a-z0-9])([A-Z])/g;
const TOKEN_DELIMITERS = /[.[\]"_-\s]+/;
const PURE_INTEGER = /^\d+$/;

/**
 * Path → lowercase tokens: splits on `.`/`[`/`]`/`"`/`_`/`-`/camelCase humps.
 * Drops `$`, empty tokens, and pure-integer tokens (array indices).
 */
export function tokenizeFieldPath(path: string): string[] {
  const withHumpBoundaries = path
    .replace(CAMEL_HUMP_ACRONYM, '$1 $2')
    .replace(CAMEL_HUMP_BOUNDARY, '$1 $2');

  return withHumpBoundaries
    .split(TOKEN_DELIMITERS)
    .map(token => token.toLowerCase())
    .filter(
      token => token.length > 0 && token !== '$' && !PURE_INTEGER.test(token),
    );
}

/**
 * Inverse-document-frequency over every field path (and container name) in
 * the run's corpora: idf(token) = log2(1 + N / df(token)), where N = total
 * distinct field paths across all datasources in the run and df = number of
 * those paths containing the token. Generic tokens (`id`, `name`, `key`,
 * appearing in most paths) end up with weight ≈ log2(2)=1, rare tokens with
 * weight ≈ log2(N).
 *
 * Container names contribute extra df counts (a container's name is itself a
 * "document" tokens can appear in) but are not counted toward N — N is
 * strictly the distinct-field-path count the spec defines it as.
 */
export function buildTokenIdf(params: {
  fieldPathsByDatasource: Record<string, string[]>;
  containerNamesByDatasourceId?: Record<string, string>;
}): Map<string, number> {
  const distinctPaths = new Set<string>();
  for (const paths of Object.values(params.fieldPathsByDatasource)) {
    for (const path of paths) {
      distinctPaths.add(path);
    }
  }
  const totalDistinctPaths = distinctPaths.size;

  const documents: string[][] = [];
  for (const path of distinctPaths) {
    documents.push(tokenizeFieldPath(path));
  }
  // Dedupe by name: two datasources sharing the same container name (e.g.
  // two "users" tables) should count as one document, not double-weight it.
  const containerNames = new Set(
    Object.values(params.containerNamesByDatasourceId ?? {}),
  );
  for (const name of containerNames) {
    documents.push(tokenizeFieldPath(name));
  }

  const documentFrequency = new Map<string, number>();
  for (const tokens of documents) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [token, df] of documentFrequency) {
    idf.set(token, Math.log2(1 + totalDistinctPaths / df));
  }
  return idf;
}

function bridgesSingularPlural(
  dependentToken: string,
  referencedTokens: Set<string>,
): boolean {
  if (referencedTokens.has(`${dependentToken}s`)) {
    return true;
  }
  return (
    dependentToken.endsWith('s') &&
    referencedTokens.has(dependentToken.slice(0, -1))
  );
}

// A token's raw idf floors at log2(2) = 1 when it's ubiquitous (appears in
// every document); "informative" subtracts that floor off so ubiquitous
// tokens (id/key/name) contribute exactly 0 to either sum instead of the
// same weight as everything else. This is what makes an all-generic overlap
// (e.g. `$.id` vs `$.id`) score 0 rather than a trivial perfect match.
function informative(weight: number): number {
  return Math.max(0, weight - 1);
}

/**
 * Container-aware weighted token overlap in [0, 1]: tokens(dependent field
 * path) vs tokens(referenced field path) ∪ tokens(referenced container
 * name). Overlap weight = Σ informative(idf(shared)) /
 * Σ informative(idf(dependent tokens)); 0 when the denominator is 0 (every
 * dependent token is generic). A dependent token also matches when it
 * equals a referenced token + 's' or vice versa (account_id ↔ aws-accounts).
 */
export function nameSimilarity(params: {
  dependentFieldPath: string;
  referencedFieldPath: string;
  referencedContainerName?: string;
  idf: Map<string, number>;
}): number {
  const dependentTokens = new Set(tokenizeFieldPath(params.dependentFieldPath));
  if (dependentTokens.size === 0) {
    return 0;
  }

  const referencedTokens = new Set(
    tokenizeFieldPath(params.referencedFieldPath),
  );
  if (params.referencedContainerName) {
    for (const token of tokenizeFieldPath(params.referencedContainerName)) {
      referencedTokens.add(token);
    }
  }

  let sharedWeight = 0;
  let totalWeight = 0;
  for (const token of dependentTokens) {
    // A token missing from the idf map falls back to the generic weight (1),
    // whose informative contribution is 0 — an unseen token is treated as
    // uninformative rather than infinitely rare or infinitely common.
    const weight = informative(
      params.idf.get(`${token}`) ?? GENERIC_FALLBACK_IDF,
    );
    totalWeight += weight;
    if (
      referencedTokens.has(token) ||
      bridgesSingularPlural(token, referencedTokens)
    ) {
      sharedWeight += weight;
    }
  }

  return totalWeight === 0 ? 0 : sharedWeight / totalWeight;
}
