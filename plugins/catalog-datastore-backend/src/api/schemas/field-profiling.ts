import type {
  RelationshipSuggestionFieldStats,
  RelationshipSuggestionValueType,
} from '@roadiehq/catalog-datastore-common';
import {
  classifyRelationshipCandidateValue,
  expandIdentifierSearchAliases,
  expandPersonNameSearchAliases,
} from './relationshipCandidateFilter';
import { dominantValueType } from '../_shared';

export type SearchResult = {
  val: string;
  datasourceId: string;
  objectId: string;
  object: unknown;
  /**
   * When the result came from a fuzzy comparison, this is the value as it
   * actually appears in the target object (which differs from `val`).
   * `findPathsForValue` uses this to locate the target field. When absent,
   * the result is treated as an exact match and `val` is used directly.
   */
  targetVal?: string;
  /** Jaro-Winkler / token-set similarity in (0, 1] when fuzzy; absent for exact. */
  fuzzyScore?: number;
  /**
   * Set when the result came from a prefix-contains pass: the source value is
   * a strict prefix of the target value (e.g. deployment name → pod name).
   * Treated as evidence for `matchStrategy: 'contains'` rather than a fuzzy
   * approximation, so it doesn't incur the fuzzy score discount.
   */
  containsMatch?: boolean;
};

export type FieldValueContainer = 'scalar' | 'array' | 'mixed';

export interface ExtractedFieldValue {
  value: string;
  container: Exclude<FieldValueContainer, 'mixed'>;
}

export type ExtractedFieldMap = Map<string, ExtractedFieldValue[]>;

interface FieldAggregation {
  rowsWithAnyValue: number;
  valueCounts: Map<string, number>;
  valueTypeCounts: Map<RelationshipSuggestionValueType, number>;
  containerCounts: Map<Exclude<FieldValueContainer, 'mixed'>, number>;
  topValueCount: number;
}

export interface FieldProfile {
  field: string;
  rowCount: number;
  distinctCount: number;
  rowCoverage: number;
  cardinalityRatio: number;
  looksEnumLike: boolean;
  isIdentifierLike: boolean;
  dominantValueType: RelationshipSuggestionValueType;
  valueContainer: FieldValueContainer;
  valueTypeDistribution: Partial<
    Record<RelationshipSuggestionValueType, number>
  >;
  valueCounts: Record<string, number>;
}

export interface FieldProfileSet {
  valueToFields: Record<string, Record<string, number>>;
  profilesByField: Record<string, FieldProfile>;
  /** field → (alias search token → the canonical value it was expanded from,
   *  for person-name and identifier aliases). Field profiles store only
   *  canonical values, but the accumulator records whichever token matched
   *  (often an alias), so containment/support coverage maps matched tokens back
   *  through this to count distinct canonical SOURCE values rather than alias
   *  variants. Keyed BY FIELD: the same token can be a genuine value on one
   *  field and an alias of a different canonical on another, and a datasource-
   *  wide table would rewrite the genuine value to the wrong canonical, dropping
   *  a real identifier join. */
  canonicalByAlias: Record<string, Record<string, string>>;
}

export function quoteKey(key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `'${key}'`;
}

export function isKeyValuePairArray(arr: unknown[]): boolean {
  if (arr.length === 0) {
    return false;
  }
  return arr.every(item => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return false;
    }
    const entries = Object.entries(item as Record<string, unknown>);
    return (
      entries.length === 2 &&
      entries.every(([, value]) => typeof value === 'string')
    );
  });
}

export function toFieldStats(
  profile?: FieldProfile,
): RelationshipSuggestionFieldStats {
  return {
    distinctCount: profile?.distinctCount ?? 0,
    rowCoverage: profile?.rowCoverage ?? 0,
    cardinalityRatio: profile?.cardinalityRatio ?? 0,
    looksEnumLike: profile?.looksEnumLike ?? false,
    isIdentifierLike: profile?.isIdentifierLike ?? false,
  };
}

export function classifyValueType(
  value: string,
): RelationshipSuggestionValueType {
  return classifyRelationshipCandidateValue(value) ?? 'other';
}

function extractFieldValues(
  obj: unknown,
  prefix: string,
  result: ExtractedFieldMap,
  container: Exclude<FieldValueContainer, 'mixed'> = 'scalar',
): void {
  if (obj === null || obj === undefined) {
    return;
  }

  if (typeof obj === 'string') {
    const list = result.get(prefix) ?? [];
    list.push({ value: obj, container });
    result.set(prefix, list);
    return;
  }

  // Integers double as join keys once canonicalized to their string form;
  // non-integer numbers are measures (prices, ratios, …), not identifiers,
  // so they're intentionally excluded.
  if (typeof obj === 'number') {
    if (Number.isInteger(obj)) {
      const list = result.get(prefix) ?? [];
      list.push({ value: String(obj), container });
      result.set(prefix, list);
    }
    return;
  }

  if (Array.isArray(obj)) {
    if (isKeyValuePairArray(obj)) {
      for (const item of obj) {
        const entries = Object.entries(item as Record<string, string>);
        const [field1, val1] = entries[0];
        const [field2, val2] = entries[1];
        const path1 = `${prefix}[${field2}="${val2}"].${field1}`;
        const path2 = `${prefix}[${field1}="${val1}"].${field2}`;
        result.set(path1, [
          ...(result.get(path1) ?? []),
          { value: val1, container: 'array' },
        ]);
        result.set(path2, [
          ...(result.get(path2) ?? []),
          { value: val2, container: 'array' },
        ]);
      }
      return;
    }

    for (const item of obj) {
      extractFieldValues(item, prefix, result, 'array');
    }
    return;
  }

  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      extractFieldValues(
        value,
        `${prefix}.${quoteKey(key)}`,
        result,
        container,
      );
    }
  }
}

/** Adds handle-shaped aliases for person_name literals. */
export function applyPersonNameAliasesToExtracted(
  extracted: ExtractedFieldMap,
): void {
  for (const entries of extracted.values()) {
    if (!entries.length) {
      continue;
    }
    const seen = new Set(entries.map(entry => entry.value));
    for (const entry of [...entries]) {
      const value = entry.value;
      if (classifyRelationshipCandidateValue(value) !== 'person_name') {
        continue;
      }
      for (const alias of expandPersonNameSearchAliases(value)) {
        if (!seen.has(alias)) {
          seen.add(alias);
          entries.push({ value: alias, container: entry.container });
        }
      }
    }
  }
}

export function extractStringValues(
  obj: unknown,
  prefix: string,
  result: Record<string, Record<string, number>>,
) {
  const extracted: ExtractedFieldMap = new Map();
  extractFieldValues(obj, prefix, extracted);
  applyPersonNameAliasesToExtracted(extracted);
  const merged = new Map<string, Map<string, number>>(
    Object.entries(result).map(([field, counts]) => [
      field,
      new Map(Object.entries(counts)),
    ]),
  );
  for (const [field, entries] of extracted) {
    const counts = merged.get(field) ?? new Map<string, number>();
    for (const { value } of entries) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    merged.set(field, counts);
  }
  for (const key of Object.keys(result)) {
    Reflect.deleteProperty(result, key);
  }
  Object.assign(
    result,
    Object.fromEntries(
      [...merged].map(([field, counts]) => [field, Object.fromEntries(counts)]),
    ),
  );
}

export function buildValueToFieldsMap(
  objects: unknown[],
): Record<string, Record<string, number>> {
  return buildFieldProfiles(objects).valueToFields;
}

export function buildFieldProfiles(objects: unknown[]): FieldProfileSet {
  const aggregations = new Map<string, FieldAggregation>();

  for (const object of objects) {
    const extracted: ExtractedFieldMap = new Map();
    extractFieldValues(object, '$', extracted);

    for (const [field, entries] of extracted) {
      const filteredEntries = entries.filter(entry => Boolean(entry.value));
      const uniqueValues = new Set(filteredEntries.map(entry => entry.value));
      if (uniqueValues.size === 0) {
        continue;
      }

      let aggregation = aggregations.get(field);
      if (!aggregation) {
        aggregation = {
          rowsWithAnyValue: 0,
          valueCounts: new Map(),
          valueTypeCounts: new Map(),
          containerCounts: new Map(),
          topValueCount: 0,
        };
        aggregations.set(field, aggregation);
      }

      aggregation.rowsWithAnyValue += 1;
      const rowContainers = new Set(
        filteredEntries.map(entry => entry.container),
      );
      for (const valueContainer of rowContainers) {
        aggregation.containerCounts.set(
          valueContainer,
          (aggregation.containerCounts.get(valueContainer) ?? 0) + 1,
        );
      }
      for (const value of uniqueValues) {
        aggregation.valueCounts.set(
          value,
          (aggregation.valueCounts.get(value) ?? 0) + 1,
        );
        aggregation.topValueCount = Math.max(
          aggregation.topValueCount,
          aggregation.valueCounts.get(value) ?? 0,
        );
        const valueType = classifyValueType(value);
        aggregation.valueTypeCounts.set(
          valueType,
          (aggregation.valueTypeCounts.get(valueType) ?? 0) + 1,
        );
      }
    }
  }

  const profilesByFieldMap = new Map<string, FieldProfile>();
  const valueToFieldsMap = new Map<string, Map<string, number>>();
  const canonicalByAliasMap = new Map<string, Map<string, string>>();

  const bumpValueToFieldsMap = (val: string, field: string, c: number) => {
    const counts = valueToFieldsMap.get(val) ?? new Map<string, number>();
    counts.set(field, (counts.get(field) ?? 0) + c);
    valueToFieldsMap.set(val, counts);
  };

  for (const [field, aggregation] of aggregations.entries()) {
    const distinctCount = aggregation.valueCounts.size;
    const rowCount = objects.length;
    const rowCoverage =
      rowCount === 0 ? 0 : aggregation.rowsWithAnyValue / rowCount;
    const cardinalityRatio =
      aggregation.rowsWithAnyValue === 0
        ? 0
        : distinctCount / aggregation.rowsWithAnyValue;
    const topValueShare =
      aggregation.rowsWithAnyValue === 0
        ? 0
        : aggregation.topValueCount / aggregation.rowsWithAnyValue;
    const dominantType = dominantValueType(aggregation.valueTypeCounts);
    const scalarCount = aggregation.containerCounts.get('scalar') ?? 0;
    const arrayCount = aggregation.containerCounts.get('array') ?? 0;
    const valueContainer: FieldValueContainer =
      scalarCount > 0 && arrayCount > 0
        ? 'mixed'
        : arrayCount > 0
          ? 'array'
          : 'scalar';
    const looksEnumLike =
      rowCoverage >= 0.4 &&
      cardinalityRatio <= 0.6 &&
      topValueShare >= 0.5 &&
      distinctCount <= Math.max(12, Math.ceil(rowCount * 0.5));
    const isIdentifierLike =
      ['uuid', 'email', 'handle', 'slug', 'numeric_id'].includes(
        dominantType,
      ) &&
      cardinalityRatio >= 0.5 &&
      rowCoverage >= 0.2 &&
      !looksEnumLike;

    profilesByFieldMap.set(field, {
      field,
      rowCount,
      distinctCount,
      rowCoverage,
      cardinalityRatio,
      looksEnumLike,
      isIdentifierLike,
      dominantValueType: dominantType,
      valueContainer,
      valueTypeDistribution: Object.fromEntries(
        aggregation.valueTypeCounts.entries(),
      ) as Partial<Record<RelationshipSuggestionValueType, number>>,
      valueCounts: Object.fromEntries(aggregation.valueCounts.entries()),
    });

    for (const [value, count] of aggregation.valueCounts.entries()) {
      const classification = classifyRelationshipCandidateValue(value);
      if (classification === null) {
        continue;
      }
      // Skip the redundant classification for the primary value — we already
      // classified it as non-null above.
      bumpValueToFieldsMap(value, field, count);
      const aliases =
        classification === 'person_name'
          ? expandPersonNameSearchAliases(value)
          : expandIdentifierSearchAliases(value);
      for (const alias of aliases) {
        if (
          alias !== value &&
          classifyRelationshipCandidateValue(alias) !== null
        ) {
          bumpValueToFieldsMap(alias, field, count);
          // Remember which canonical this alias came from, scoped to THIS field,
          // so coverage can count distinct source values, not alias variants.
          // Field-scoped because a token that is an alias here may be a real
          // value on another field. First writer wins on the rare same-field
          // cross-name collision — deterministic under the sorted iteration.
          const fieldAliases =
            canonicalByAliasMap.get(field) ?? new Map<string, string>();
          if (!fieldAliases.has(alias)) {
            fieldAliases.set(alias, value);
          }
          canonicalByAliasMap.set(field, fieldAliases);
        }
      }
    }
  }

  const profilesByField = Object.fromEntries(profilesByFieldMap);
  const valueToFields = Object.fromEntries(
    [...valueToFieldsMap].map(([value, counts]) => [
      value,
      Object.fromEntries(counts),
    ]),
  );

  return {
    valueToFields,
    profilesByField,
    canonicalByAlias: Object.fromEntries(
      [...canonicalByAliasMap].map(([field, aliases]) => [
        field,
        Object.fromEntries(aliases),
      ]),
    ),
  };
}

export function findPathsForValue(
  obj: unknown,
  target: string,
  prefix: string = '$',
): string[] {
  if (obj === null || obj === undefined) {
    return [];
  }
  if (typeof obj === 'string') {
    if (obj === target) {
      return [prefix];
    }
    if (
      classifyRelationshipCandidateValue(obj) === 'person_name' &&
      expandPersonNameSearchAliases(obj).includes(target)
    ) {
      return [prefix];
    }
    return [];
  }
  // Mirrors extractFieldValues: integer leaves are canonicalized to their
  // string form for matching; non-integers were never profiled as keys.
  // Literal string equality, so a zero-padded source string ("007") never
  // unifies with the number 7 (canonical form "7") — pre-existing, accepted.
  if (typeof obj === 'number') {
    return Number.isInteger(obj) && String(obj) === target ? [prefix] : [];
  }
  if (Array.isArray(obj)) {
    const paths: string[] = [];
    if (isKeyValuePairArray(obj)) {
      for (const item of obj) {
        const entries = Object.entries(item as Record<string, string>);
        const [field1, val1] = entries[0];
        const [field2, val2] = entries[1];
        if (val1 === target) {
          paths.push(`${prefix}[${field2}="${val2}"].${field1}`);
        }
        if (val2 === target) {
          paths.push(`${prefix}[${field1}="${val1}"].${field2}`);
        }
      }
    } else {
      for (const item of obj) {
        paths.push(...findPathsForValue(item, target, prefix));
      }
    }
    return paths;
  }
  if (typeof obj === 'object') {
    const paths: string[] = [];
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      paths.push(
        ...findPathsForValue(value, target, `${prefix}.${quoteKey(key)}`),
      );
    }
    return paths;
  }
  return [];
}
