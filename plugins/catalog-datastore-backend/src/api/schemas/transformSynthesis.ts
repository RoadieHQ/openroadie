/**
 * Deterministic Auto-Join-style transform synthesis for gate-suppressed
 * relationship candidates (sc-34xxx suggestion-quality stage 4). Given a
 * dependent field's value distribution and the referenced field's value set,
 * tries a small closed grammar of string transforms and returns the single
 * best one whose consistency clears TRANSFORM_CONSISTENCY_MIN — or a
 * composite (two sibling fields joined by a delimiter) candidate via
 * `synthesizeCompositeKey`. Pure: no I/O, no randomness, fully sorted
 * iteration so two runs over the same input always agree.
 */

export const TRANSFORM_CONSISTENCY_MIN = 0.85;
export const MIN_TRANSFORM_VALUE_LENGTH = 4;

// Below this, composing a rule 2-4 program with a trailing case-fold isn't
// worth attempting — the base transform barely fires at all, and casing
// alone won't rescue it up to TRANSFORM_CONSISTENCY_MIN.
const FOLD_RETRY_FLOOR = 0.3;

const DELIMITER_CHARS: readonly string[] = ['-', '_', '.', '/', ':', '@'];

export interface TransformProgram {
  /** stable id, e.g. 'strip-suffix:-backstage' | 'case-fold' |
   *  'before-delim:-' | 'after-delim:/' | 'composite::' */
  name: string;
  /** JSONata rendering over the dependent field path, e.g.
   *  "$substringBefore($.id, '-backstage')" */
  renderExpression(fieldPath: string): string;
  apply(value: string): string | undefined;
  /**
   * True when `renderExpression` wraps its result in `$lowercase(...)` (i.e.
   * this program was composed via `withFinalFold`). A consumer that must
   * mirror the rendered JSONata for a value where the base transform doesn't
   * fire (`apply` returns undefined, e.g. a strip whose literal is absent)
   * needs this: the persisted `$substringBefore`/`$substringAfter` passes such
   * a value through unchanged, and an outer `$lowercase` then lowercases it —
   * so the honest pass-through is `value.toLowerCase()`, not the raw value.
   * See `applyWithPassthrough` in suggestRelationshipsService.ts.
   */
  foldsResult?: boolean;
}

export interface TransformSynthesisResult {
  program: TransformProgram;
  /** fraction of eligible dependent values whose transform lands in the
   *  referenced eligible set */
  consistency: number;
  /**
   * transformed dependent value -> count (for re-gating / re-profiling).
   * Asymmetric for strip-suffix/strip-prefix: `apply` returns undefined (and
   * so omits the value here) for a dependent value missing the literal, but
   * the PERSISTED rule's rendered $substringBefore/$substringAfter passes
   * that same value through unchanged at apply time — this profile is
   * therefore optimistic and won't include those pass-through values.
   * For `synthesizeCompositeKey`, this is instead the matched-referenced
   * intersection with every count forced to 1 (an unweighted `Set`, not a
   * joint distribution) — re-gating a composite against it would be
   * circular, since it's already exactly the referenced values the
   * composite was chosen to explain.
   */
  transformedValueCounts: Record<string, number>;
}

// Plain codepoint comparison, not localeCompare — program/field names reach
// the tie-break, which must be stable across ICU versions/environments.
function codepointCompare(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// JSONata single-quoted string literal escaping. None of the fixed delimiter
// chars need it, but a strip-suffix/prefix literal is derived from real data
// and could contain a backslash or quote.
function jsonataStringLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function eligibleEntries(
  valueCounts: Record<string, number>,
): Array<[string, number]> {
  return Object.entries(valueCounts).filter(
    ([value]) => value.length >= MIN_TRANSFORM_VALUE_LENGTH,
  );
}

function caseFoldProgram(): TransformProgram {
  return {
    name: 'case-fold',
    renderExpression: fieldPath => `$lowercase(${fieldPath})`,
    apply: value => value.toLowerCase(),
  };
}

function stripSuffixProgram(literal: string): TransformProgram {
  return {
    name: `strip-suffix:${literal}`,
    renderExpression: fieldPath =>
      `$substringBefore(${fieldPath}, ${jsonataStringLiteral(literal)})`,
    // Uses indexOf — the FIRST occurrence, exactly mirroring $substringBefore
    // — so a literal that also appears earlier in the string truncates at
    // the same point the persisted rule would. Diverges from raw
    // $substringBefore only when the literal is absent entirely: this
    // returns undefined (a miss), not the value unchanged, since a value
    // lacking the literal never exhibited the suffix pattern this program
    // models (see the transformedValueCounts asymmetry note above).
    apply: value => {
      const idx = value.indexOf(literal);
      return idx === -1 ? undefined : value.slice(0, idx);
    },
  };
}

function stripPrefixProgram(literal: string): TransformProgram {
  return {
    name: `strip-prefix:${literal}`,
    renderExpression: fieldPath =>
      `$substringAfter(${fieldPath}, ${jsonataStringLiteral(literal)})`,
    // Symmetric with stripSuffixProgram: indexOf (first occurrence, mirroring
    // $substringAfter) when present, undefined (not pass-through) when absent.
    apply: value => {
      const idx = value.indexOf(literal);
      return idx === -1 ? undefined : value.slice(idx + literal.length);
    },
  };
}

function beforeDelimProgram(delimiter: string): TransformProgram {
  return {
    name: `before-delim:${delimiter}`,
    renderExpression: fieldPath =>
      `$substringBefore(${fieldPath}, ${jsonataStringLiteral(delimiter)})`,
    // Mirrors JSONata's $substringBefore exactly (first occurrence via
    // indexOf; the value unchanged, not undefined, when absent) — the
    // rendered expression is what the apply engine evaluates verbatim, so
    // this must match its behavior bit for bit, including the absent case.
    apply: value => {
      const idx = value.indexOf(delimiter);
      return idx === -1 ? value : value.slice(0, idx);
    },
  };
}

function afterDelimProgram(delimiter: string): TransformProgram {
  return {
    name: `after-delim:${delimiter}`,
    renderExpression: fieldPath =>
      `$substringAfter(${fieldPath}, ${jsonataStringLiteral(delimiter)})`,
    apply: value => {
      const idx = value.indexOf(delimiter);
      return idx === -1 ? value : value.slice(idx + delimiter.length);
    },
  };
}

function withFinalFold(program: TransformProgram): TransformProgram {
  return {
    name: `${program.name}+fold`,
    renderExpression: fieldPath =>
      `$lowercase(${program.renderExpression(fieldPath)})`,
    apply: value => {
      const transformed = program.apply(value);
      return transformed === undefined ? undefined : transformed.toLowerCase();
    },
    // The rendered expression wraps the base render in $lowercase, so a
    // pass-through value (base transform absent) is lowercased too — see the
    // TransformProgram.foldsResult doc comment.
    foldsResult: true,
  };
}

/**
 * The longest suffix (or prefix) that starts (ends, for prefix) with a
 * delimiter char, is >=2 chars, and is shared by >=TRANSFORM_CONSISTENCY_MIN
 * of the eligible dependent weight. Ties (same length) break lexically
 * smallest for determinism.
 */
function longestCommonAffix(
  eligible: Array<[string, number]>,
  totalWeight: number,
  kind: 'suffix' | 'prefix',
): string | undefined {
  const weights = new Map<string, number>();
  for (const [value, count] of eligible) {
    for (let i = 0; i < value.length; i += 1) {
      if (!DELIMITER_CHARS.includes(value[i])) {
        continue;
      }
      const candidate =
        kind === 'suffix' ? value.slice(i) : value.slice(0, i + 1);
      if (candidate.length < 2) {
        continue;
      }
      weights.set(candidate, (weights.get(candidate) ?? 0) + count);
    }
  }

  let best: string | undefined;
  for (const [candidate, weight] of weights) {
    if (weight / totalWeight < TRANSFORM_CONSISTENCY_MIN) {
      continue;
    }
    if (
      best === undefined ||
      candidate.length > best.length ||
      (candidate.length === best.length &&
        codepointCompare(candidate, best) < 0)
    ) {
      best = candidate;
    }
  }
  return best;
}

/** before-delim/after-delim candidates for every delimiter char present in
 *  >=TRANSFORM_CONSISTENCY_MIN of the eligible dependent weight. */
function delimiterCandidates(
  eligible: Array<[string, number]>,
  totalWeight: number,
): TransformProgram[] {
  const programs: TransformProgram[] = [];
  for (const delimiter of DELIMITER_CHARS) {
    let weight = 0;
    for (const [value, count] of eligible) {
      if (value.includes(delimiter)) {
        weight += count;
      }
    }
    if (weight / totalWeight >= TRANSFORM_CONSISTENCY_MIN) {
      programs.push(beforeDelimProgram(delimiter));
      programs.push(afterDelimProgram(delimiter));
    }
  }
  return programs;
}

function evaluateProgram(
  program: TransformProgram,
  eligible: Array<[string, number]>,
  referencedValueSet: Set<string>,
  totalWeight: number,
): TransformSynthesisResult {
  let matchWeight = 0;
  const transformed = new Map<string, number>();
  for (const [value, count] of eligible) {
    const result = program.apply(value);
    if (result === undefined) {
      continue;
    }
    transformed.set(result, (transformed.get(result) ?? 0) + count);
    if (referencedValueSet.has(result)) {
      matchWeight += count;
    }
  }
  return {
    program,
    consistency: totalWeight === 0 ? 0 : matchWeight / totalWeight,
    transformedValueCounts: Object.fromEntries(transformed),
  };
}

/** Tries the closed grammar; returns the single best program with
 *  consistency >= TRANSFORM_CONSISTENCY_MIN, or undefined. Ties break by
 *  (higher consistency, then lexical program name). */
export function synthesizeTransform(params: {
  dependentValueCounts: Record<string, number>; // eligible values only
  referencedValueSet: Set<string>; // eligible values only
}): TransformSynthesisResult | undefined {
  const eligible = eligibleEntries(params.dependentValueCounts);
  const totalWeight = eligible.reduce((sum, [, count]) => sum + count, 0);
  if (eligible.length === 0 || totalWeight === 0) {
    return undefined;
  }

  const basePrograms: TransformProgram[] = [];
  // Not /[A-Z]/: that misses non-ASCII uppercase (e.g. 'É'), which
  // toLowerCase() still folds.
  if (eligible.some(([value]) => value !== value.toLowerCase())) {
    basePrograms.push(caseFoldProgram());
  }
  const suffixLiteral = longestCommonAffix(eligible, totalWeight, 'suffix');
  if (suffixLiteral !== undefined) {
    basePrograms.push(stripSuffixProgram(suffixLiteral));
  }
  const prefixLiteral = longestCommonAffix(eligible, totalWeight, 'prefix');
  if (prefixLiteral !== undefined) {
    basePrograms.push(stripPrefixProgram(prefixLiteral));
  }
  basePrograms.push(...delimiterCandidates(eligible, totalWeight));

  const qualifying: TransformSynthesisResult[] = [];
  for (const program of basePrograms) {
    const result = evaluateProgram(
      program,
      eligible,
      params.referencedValueSet,
      totalWeight,
    );
    if (result.consistency >= TRANSFORM_CONSISTENCY_MIN) {
      qualifying.push(result);
      continue;
    }
    // case-fold has no further composition — rules 2-4 are the ones the
    // grammar allows composing with a trailing fold.
    if (program.name === 'case-fold' || result.consistency < FOLD_RETRY_FLOOR) {
      continue;
    }
    const foldedResult = evaluateProgram(
      withFinalFold(program),
      eligible,
      params.referencedValueSet,
      totalWeight,
    );
    if (foldedResult.consistency >= TRANSFORM_CONSISTENCY_MIN) {
      qualifying.push(foldedResult);
    }
  }

  if (qualifying.length === 0) {
    return undefined;
  }
  qualifying.sort(
    (a, b) =>
      b.consistency - a.consistency ||
      codepointCompare(a.program.name, b.program.name),
  );
  return qualifying[0];
}

/**
 * Composite keys: finds a sibling-field pair + delimiter whose join matches
 * the referenced set. Returns the rendered JSONata "fieldA & ':' & fieldB"
 * via renderExpression(unused-path).
 *
 * Contract on `candidateFieldValueCounts` keys: each MUST be a complete,
 * valid standalone JSONata path expression (e.g. `$.repo`, or `$.'repo-name'`
 * using field-profiling's `quoteKey` for a segment with special chars) — NOT
 * a bare field name. `renderExpression` interpolates the key verbatim into a
 * `&` concatenation; a bare hyphenated name like `repo-name` would parse as
 * subtraction, not a field reference, producing silently wrong output rather
 * than a synthesis error.
 */
export function synthesizeCompositeKey(params: {
  candidateFieldValueCounts: Record<string, Record<string, number>>; // sibling field -> valueCounts (eligible); keys must be standalone JSONata paths
  // Per source object, field path -> the value(s) that object holds for it.
  // The rendered JSONata concatenates the two fields PER OBJECT, so a delimiter
  // join is only real when the left/right halves co-occur on the same object;
  // without this, sibling fields are treated as independent value sets and the
  // cartesian check ratifies keys that never materialize at apply time.
  objectFieldValues: ReadonlyArray<ReadonlyMap<string, ReadonlySet<string>>>;
  referencedValueSet: Set<string>;
}):
  | (TransformSynthesisResult & { fields: [string, string]; delimiter: string })
  | undefined {
  const fieldNames = Object.keys(params.candidateFieldValueCounts).sort(
    codepointCompare,
  );
  const referencedTotal = params.referencedValueSet.size;
  if (fieldNames.length < 2 || referencedTotal === 0) {
    return undefined;
  }

  const valueSets = new Map<string, Set<string>>(
    Object.entries(params.candidateFieldValueCounts).map(([field, counts]) => [
      field,
      new Set(Object.keys(counts)),
    ]),
  );

  // Delimiters that split >=TRANSFORM_CONSISTENCY_MIN of the referenced
  // values — depends only on the referenced set, so computed once up front
  // rather than per field pair.
  const qualifyingDelimiters = DELIMITER_CHARS.filter(delimiter => {
    let weight = 0;
    for (const referenced of params.referencedValueSet) {
      if (referenced.includes(delimiter)) {
        weight += 1;
      }
    }
    return weight / referencedTotal >= TRANSFORM_CONSISTENCY_MIN;
  });
  if (qualifyingDelimiters.length === 0) {
    return undefined;
  }

  type CompositeResult = TransformSynthesisResult & {
    fields: [string, string];
    delimiter: string;
  };
  const qualifying: CompositeResult[] = [];

  // Ordered pairs, not combinations: (name, namespace) and (namespace, name)
  // are different candidates — a referenced "default/api" (namespace first)
  // only matches when fieldA is namespace and fieldB is name, so restricting
  // to i < j would silently miss that direction.
  for (let i = 0; i < fieldNames.length; i += 1) {
    for (let j = 0; j < fieldNames.length; j += 1) {
      if (i === j) {
        continue;
      }
      const fieldA = fieldNames[i];
      const fieldB = fieldNames[j];
      const valuesA = valueSets.get(fieldA);
      const valuesB = valueSets.get(fieldB);
      if (!valuesA || !valuesB) {
        continue;
      }

      // (fieldA value, fieldB value) pairs that actually occur on the same
      // object — built once per ordered pair, reused across delimiters. The
      // eligibility filter still applies via valuesA/valuesB below.
      const coOccurring = new Set<string>();
      for (const object of params.objectFieldValues) {
        const aValues = object.get(fieldA);
        const bValues = object.get(fieldB);
        if (!aValues || !bValues) {
          continue;
        }
        for (const a of aValues) {
          for (const b of bValues) {
            coOccurring.add(`${a}\u0000${b}`);
          }
        }
      }

      for (const delimiter of qualifyingDelimiters) {
        const transformed = new Map<string, number>();
        for (const referenced of params.referencedValueSet) {
          const idx = referenced.indexOf(delimiter);
          if (idx === -1) {
            continue;
          }
          const left = referenced.slice(0, idx);
          const right = referenced.slice(idx + delimiter.length);
          if (
            valuesA.has(left) &&
            valuesB.has(right) &&
            coOccurring.has(`${left}\u0000${right}`)
          ) {
            transformed.set(referenced, 1);
          }
        }
        const consistency = transformed.size / referencedTotal;
        if (consistency < TRANSFORM_CONSISTENCY_MIN) {
          continue;
        }

        qualifying.push({
          program: {
            name: `composite:${fieldA}:${fieldB}:${delimiter}`,
            renderExpression: () =>
              `${fieldA} & ${jsonataStringLiteral(delimiter)} & ${fieldB}`,
            // The composite key is realized entirely by the rendered JSONata
            // concatenation of the two sibling fields — by the time a single
            // string reaches `apply`, the join already happened, so this is a
            // pass-through kept only to satisfy the shared TransformProgram
            // shape for uniform (program-agnostic) consumption downstream.
            apply: value => value,
          },
          consistency,
          transformedValueCounts: Object.fromEntries(transformed),
          fields: [fieldA, fieldB],
          delimiter,
        });
      }
    }
  }

  if (qualifying.length === 0) {
    return undefined;
  }
  qualifying.sort(
    (a, b) =>
      b.consistency - a.consistency ||
      codepointCompare(a.program.name, b.program.name),
  );
  return qualifying[0];
}
