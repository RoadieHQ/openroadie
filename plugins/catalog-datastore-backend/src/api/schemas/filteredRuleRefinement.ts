import { buildFieldProfiles, type FieldProfileSet } from './field-profiling';

/** Fields with more distinct values than this are too fragmented to slice by. */
export const FILTER_FIELD_MAX_DISTINCT = 5;

/** Bounded work: at most this many enum-sibling fields considered per candidate. */
const MAX_ENUM_FIELDS_PER_CANDIDATE = 3;

/** A slice must still carry this many distinct values for the candidate field
 * to be worth rescuing -- fewer than 3 can't support a relationship. */
const MIN_SLICE_CANDIDATE_DISTINCT = 3;

export interface FilterRefinementResult {
  /** JSONata boolean over the source object, e.g. "$.kind = 'Deployment'" */
  filterExpression: string;
  filterField: string;
  filterValue: string;
  /** profiles rebuilt over the filtered slice */
  slicedProfiles: FieldProfileSet;
  slicedObjects: unknown[];
}

/**
 * Splits a field path produced by field-profiling (e.g. "$.metadata.name",
 * or "$.'weird-key'.sub" for a non-identifier key quoted by `quoteKey`) into
 * its navigable segments. Key-value-pair array paths (the
 * `$.foo[bar="baz"].qux` shape `field-profiling` emits for arrays of 2-key
 * objects) aren't reconstructed here -- enum-sibling candidates are plain
 * nested fields in practice, so that shape is out of scope for this walk.
 * TODO: this silently yields zero refinements for a key-value-pair-array
 * field (e.g. `$.labels[Key="Tenant"].Value`) -- revisit if the Stage 5 /
 * Task 5 rescue loop needs to slice on real label/tag corpora.
 */
function parseFieldPath(fieldPath: string): string[] {
  const body = fieldPath.startsWith('$.')
    ? fieldPath.slice(2)
    : fieldPath.replace(/^\$/, '');
  if (body === '') {
    return [];
  }
  const segments: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of body) {
    if (char === "'") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === '.' && !inQuotes) {
      segments.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  segments.push(current);
  return segments;
}

/** Mirrors field-profiling's extraction walk (array flattening, integer
 * canonicalization) but only far enough to answer "what values, if any, does
 * this object have at this field path" -- membership testing for slicing,
 * not full profiling. */
function extractValuesAtPath(obj: unknown, segments: string[]): string[] {
  if (segments.length === 0) {
    if (typeof obj === 'string') {
      return [obj];
    }
    if (typeof obj === 'number' && Number.isInteger(obj)) {
      return [String(obj)];
    }
    return [];
  }
  if (obj === null || obj === undefined) {
    return [];
  }
  if (Array.isArray(obj)) {
    return obj.flatMap(item => extractValuesAtPath(item, segments));
  }
  if (typeof obj !== 'object') {
    return [];
  }
  const [key, ...rest] = segments;
  return extractValuesAtPath((obj as Record<string, unknown>)[`${key}`], rest);
}

/** Stringified forms of leaves stored as integer NUMBERS at `segments` across
 * `objects`. extractValuesAtPath canonicalizes a numeric leaf `5` to the string
 * "5" for slicing, but the persisted filter must compare against the raw number
 * at apply time — a quoted `'5'` is unequal to `5` in JSONata, so a numeric enum
 * filter would pass gates yet match no rows. A value listed here gets an
 * unquoted numeric literal instead. */
function numericLeafStrings(obj: unknown, segments: string[]): Set<string> {
  const numeric = new Set<string>();
  const walk = (node: unknown, path: string[]): void => {
    if (path.length === 0) {
      if (typeof node === 'number' && Number.isInteger(node)) {
        numeric.add(String(node));
      }
      return;
    }
    if (node === null || node === undefined) {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, path);
      }
      return;
    }
    if (typeof node !== 'object') {
      return;
    }
    const [key, ...rest] = path;
    walk((node as Record<string, unknown>)[`${key}`], rest);
  };
  walk(obj, segments);
  return numeric;
}

/** For each enum-like sibling field (looksEnumLike, distinct <=
 *  FILTER_FIELD_MAX_DISTINCT) and each of its values (sorted), slices the
 *  source objects where that field equals the value, re-profiles the
 *  slice, and returns refinements whose slice still contains the
 *  candidate's source field with >= 3 distinct eligible values. Sorted by
 *  (filterField, filterValue); the CALLER re-gates each. */
export function enumerateFilterRefinements(params: {
  sourceObjects: unknown[];
  sourceProfiles: FieldProfileSet;
  candidateSourceField: string;
}): FilterRefinementResult[] {
  const { sourceObjects, sourceProfiles, candidateSourceField } = params;

  const enumFields = Object.values(sourceProfiles.profilesByField)
    .filter(
      profile =>
        profile.looksEnumLike &&
        profile.distinctCount <= FILTER_FIELD_MAX_DISTINCT,
    )
    .map(profile => profile.field)
    .sort()
    .slice(0, MAX_ENUM_FIELDS_PER_CANDIDATE);

  const results: FilterRefinementResult[] = [];

  for (const filterField of enumFields) {
    const segments = parseFieldPath(filterField);
    const profile = sourceProfiles.profilesByField[`${filterField}`];
    const filterValues = Object.keys(profile.valueCounts)
      // JSONata single-quoted literals would need escaping for embedded
      // quotes; excluding such values is simpler and safer than getting
      // escaping subtly wrong, and enum-like values essentially never
      // contain quotes in practice.
      .filter(value => !value.includes("'"))
      .sort()
      .slice(0, FILTER_FIELD_MAX_DISTINCT);
    const numericValues = numericLeafStrings(sourceObjects, segments);

    for (const filterValue of filterValues) {
      const slicedObjects = sourceObjects.filter(object =>
        extractValuesAtPath(object, segments).includes(filterValue),
      );
      if (slicedObjects.length === 0) {
        continue;
      }

      const slicedProfiles = buildFieldProfiles(slicedObjects);
      const candidateProfile =
        slicedProfiles.profilesByField[`${candidateSourceField}`];
      if (
        !candidateProfile ||
        candidateProfile.distinctCount < MIN_SLICE_CANDIDATE_DISTINCT
      ) {
        continue;
      }

      // A value stored as a number needs an unquoted JSONata literal, or the
      // apply-time comparison (raw number vs quoted string) is always false.
      const literal = numericValues.has(filterValue)
        ? filterValue
        : `'${filterValue}'`;
      results.push({
        filterExpression: `${filterField} = ${literal}`,
        filterField,
        filterValue,
        slicedProfiles,
        slicedObjects,
      });
    }
  }

  return results;
}
