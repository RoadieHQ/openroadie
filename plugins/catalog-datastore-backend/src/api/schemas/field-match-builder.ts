import type {
  RelationshipConfidenceBand,
  RelationshipRuleMatchStrategy,
  RelationshipSuggestionEvidenceSummary,
  RelationshipSuggestionFieldSemantic,
  RelationshipSuggestionKind,
  RelationshipSuggestionValueType,
} from '@roadiehq/catalog-datastore-common';
import { inferRelationshipType } from './relationshipTypeInference';
import { classifyRelationshipFieldSemantic } from './semanticFieldClassification';
import { dominantValueType } from '../_shared';
import {
  buildFieldProfiles,
  classifyValueType,
  findPathsForValue,
  type FieldProfile,
  type SearchResult,
} from './field-profiling';

const IDENTITY_KIND_VALUE_TYPES: readonly RelationshipSuggestionValueType[] = [
  'uuid',
  'email',
  'handle',
  'slug',
  'numeric_id',
];

interface MatchAccumulator {
  matchCount: number;
  fuzzyMatchCount: number;
  containsMatchCount: number;
  sampleValues: Set<string>;
  valueCounts: Map<string, number>;
  valueTypes: Map<RelationshipSuggestionValueType, number>;
}

export type FieldMatchSource = 'deterministic';

export interface FieldMatch {
  sourceDatasourceId?: string;
  sourceField: string;
  targetDatasourceId: string;
  targetField: string;
  matchCount: number;
  sampleValues: string[];
  suggestionKind: RelationshipSuggestionKind;
  score: number;
  confidenceBand: RelationshipConfidenceBand;
  evidenceSummary: RelationshipSuggestionEvidenceSummary;
  suppressionReason?: string;
  contributedBy?: FieldMatchSource[];
  /**
   * Recommended match strategy for the persisted rule. Defaults to `'exact'`
   * when the matched values can be compared literally. Set to
   * `'person_name_alias'` when either side has person_name-dominant values
   * so that at apply time we expand aliases (e.g. `Alice Anderson → aanderson`)
   * and the rule materialises relationships, not just a clean-looking suggestion.
   */
  matchStrategy?: RelationshipRuleMatchStrategy;
  /**
   * Heuristic relationship type inferred from the source/target field paths.
   * `relatedTo` when no semantic verb can be inferred (the persistence layer
   * defaults to the same value, so this is also a hint for the review UI).
   */
  relationshipType?: string;
  reciprocalRelationshipType?: string;
  /**
   * Rendered JSONata for a transform-rescued candidate (stage 4 rescue loop).
   * `sourceField` itself already becomes this same string — see
   * suggestRelationshipsService.ts's rescue loop doc comment — so this is a
   * wire-visible mirror, not a distinct value; the original field path is
   * carried instead on `evidenceSummary.rescue.originalField`.
   */
  sourceExpression?: string;
  /**
   * JSONata boolean filter over the source object for a filter-rescued
   * candidate (e.g. "$.kind = 'Deployment'"). `sourceField` is unchanged for
   * a filter rescue.
   */
  sourceFilterExpression?: string;
}

/**
 * What the builder produces, before gates or scoring — everything `FieldMatch`
 * carries except the fields that only exist once a candidate is scored
 * (`score`, `confidenceBand`, `suppressionReason`, `evidenceSummary`), plus the
 * raw evidence the gate/scoring stages need but the builder already computed
 * while accumulating matches.
 */
export interface CandidateMatch extends Omit<
  FieldMatch,
  'score' | 'confidenceBand' | 'suppressionReason' | 'evidenceSummary'
> {
  valueCounts: Map<string, number>;
  valueTypes: RelationshipSuggestionValueType[];
  distinctMatchedValueCount: number;
  fuzzyMatchCount: number;
  sourceFieldSemantic: RelationshipSuggestionFieldSemantic;
  targetFieldSemantic: RelationshipSuggestionFieldSemantic;
  topMatchedValues: string[];
}

export function sourceFieldPriority(field: string): number {
  const qualifierCount = (field.match(/\[/g) ?? []).length;
  const depth = field.split('.').length;
  return qualifierCount * 10 + depth;
}

function deduplicateSourceFields(
  valueToFields: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> {
  const fieldToValues = new Map<string, Set<string>>();
  for (const [value, fields] of Object.entries(valueToFields)) {
    for (const field of Object.keys(fields)) {
      const set = fieldToValues.get(field) ?? new Set<string>();
      set.add(value);
      fieldToValues.set(field, set);
    }
  }

  const groups = new Map<string, string[]>();
  for (const [field, values] of fieldToValues) {
    const key = [...values].sort().join('\0');
    groups.set(key, [...(groups.get(key) ?? []), field]);
  }

  const fieldsToRemove = new Set<string>();
  for (const fields of groups.values()) {
    if (fields.length <= 1) {
      continue;
    }
    fields.sort((a, b) => sourceFieldPriority(a) - sourceFieldPriority(b));
    for (const f of fields.slice(1)) {
      fieldsToRemove.add(f);
    }
  }

  if (fieldsToRemove.size === 0) {
    return valueToFields;
  }

  return Object.fromEntries(
    Object.entries(valueToFields)
      .map(([value, fields]) => {
        const filtered = Object.fromEntries(
          Object.entries(fields).filter(
            ([field]) => !fieldsToRemove.has(field),
          ),
        );
        return [value, filtered] as const;
      })
      .filter(([, filtered]) => Object.keys(filtered).length > 0),
  );
}

function hasMatchedValueQualifier(path: string, matchedValue: string): boolean {
  const regex = /\[[^\]]+="([^"]*)"\]/g;
  let match = regex.exec(path);
  while (match !== null) {
    if (match[1] === matchedValue) {
      return true;
    }
    match = regex.exec(path);
  }
  return false;
}

function buildTargetProfiles(
  targetObjectsByDatasource: Record<string, unknown[]>,
): Record<string, Record<string, FieldProfile>> {
  return Object.fromEntries(
    Object.entries(targetObjectsByDatasource).map(([datasourceId, objects]) => [
      datasourceId,
      buildFieldProfiles(objects).profilesByField,
    ]),
  );
}

export function buildFieldMatchSuggestions(
  valueToFields: Record<string, Record<string, number>>,
  searchResults: SearchResult[],
  sourceProfiles?: Record<string, FieldProfile>,
  targetProfilesByDatasource: Record<string, Record<string, FieldProfile>> = {},
  sourceDatasourceId?: string,
): CandidateMatch[] {
  const dedupedValueToFields = deduplicateSourceFields(valueToFields);

  const sourceProfilesMap = sourceProfiles
    ? new Map(Object.entries(sourceProfiles))
    : undefined;
  const targetProfilesMap = new Map(
    Object.entries(targetProfilesByDatasource).map(([k, v]) => [
      k,
      new Map(Object.entries(v)),
    ]),
  );

  const matchMap = new Map<string, MatchAccumulator>();

  for (const result of searchResults) {
    const targetSearchValue = result.targetVal ?? result.val;
    const targetPaths = findPathsForValue(result.object, targetSearchValue);
    if (targetPaths.length === 0) {
      continue;
    }
    const sourceFields = dedupedValueToFields[result.val];
    if (!sourceFields) {
      continue;
    }
    const isContains = result.containsMatch === true;
    const isFuzzy = !isContains && result.targetVal !== undefined;
    const valueType = classifyValueType(result.val);
    for (const sourceField of Object.keys(sourceFields)) {
      for (const targetPath of targetPaths) {
        if (hasMatchedValueQualifier(targetPath, targetSearchValue)) {
          continue;
        }
        const key = `${sourceField}|${result.datasourceId}|${targetPath}`;
        const accumulator = matchMap.get(key) ?? {
          matchCount: 0,
          fuzzyMatchCount: 0,
          containsMatchCount: 0,
          sampleValues: new Set<string>(),
          valueCounts: new Map<string, number>(),
          valueTypes: new Map<RelationshipSuggestionValueType, number>(),
        };
        accumulator.matchCount += 1;
        if (isFuzzy) {
          accumulator.fuzzyMatchCount += 1;
        }
        if (isContains) {
          accumulator.containsMatchCount += 1;
        }
        accumulator.sampleValues.add(result.val);
        accumulator.valueCounts.set(
          result.val,
          (accumulator.valueCounts.get(result.val) ?? 0) + 1,
        );
        accumulator.valueTypes.set(
          valueType,
          (accumulator.valueTypes.get(valueType) ?? 0) + 1,
        );
        matchMap.set(key, accumulator);
      }
    }
  }

  const suggestions: CandidateMatch[] = [];
  for (const [key, data] of matchMap.entries()) {
    const firstPipe = key.indexOf('|');
    const secondPipe = key.indexOf('|', firstPipe + 1);
    const rawSourceField = key.substring(0, firstPipe);
    const rawTargetDatasourceId = key.substring(firstPipe + 1, secondPipe);
    const rawTargetField = key.substring(secondPipe + 1);
    const rawSourceProfile = sourceProfilesMap?.get(rawSourceField);
    const rawTargetProfile = targetProfilesMap
      .get(rawTargetDatasourceId)
      ?.get(rawTargetField);
    const shouldReverseArrayContains =
      sourceDatasourceId !== undefined &&
      rawSourceProfile?.valueContainer === 'array' &&
      rawTargetProfile?.valueContainer === 'scalar';
    const sourceField = shouldReverseArrayContains
      ? rawTargetField
      : rawSourceField;
    const targetDatasourceId = shouldReverseArrayContains
      ? sourceDatasourceId
      : rawTargetDatasourceId;
    const targetField = shouldReverseArrayContains
      ? rawSourceField
      : rawTargetField;
    const suggestionSourceDatasourceId = shouldReverseArrayContains
      ? rawTargetDatasourceId
      : sourceDatasourceId;
    const sourceProfile = shouldReverseArrayContains
      ? rawTargetProfile
      : rawSourceProfile;
    const targetProfile = shouldReverseArrayContains
      ? rawSourceProfile
      : rawTargetProfile;
    const sourceFieldSemantic = classifyRelationshipFieldSemantic(sourceField);
    const targetFieldSemantic = classifyRelationshipFieldSemantic(targetField);

    // Identity iff both profiles are identifier-like AND the dominant matched
    // type is one of the strong-identifier shapes — the scorer's old rule,
    // now derived without scoring. 'relationship' is the enum's only other
    // value (there is no separate "correlation" kind).
    const dominantType = dominantValueType(data.valueTypes);
    const suggestionKind: RelationshipSuggestionKind =
      (sourceProfile?.isIdentifierLike ?? false) &&
      (targetProfile?.isIdentifierLike ?? false) &&
      IDENTITY_KIND_VALUE_TYPES.includes(dominantType)
        ? 'identity'
        : 'relationship';

    const topMatchedValues = [...data.valueCounts.entries()]
      .sort((a, b) => b[1] - a[1] || codepointCompare(a[0], b[0]))
      .slice(0, 5)
      .map(([value]) => value);

    // Strategy precedence:
    //   1. `contains` when the dominant evidence is prefix/contains matches
    //      (e.g. deployment name `backstage-foo` → pod `backstage-foo-abc-123`).
    //   2. `array_contains` when scalar values match target array elements.
    //   3. `person_name_alias` when either side is person_name-dominant
    //      (so `Alice Anderson` materialises as `aanderson` at apply time).
    //   4. `exact` otherwise.
    const containsDominant =
      data.containsMatchCount > 0 &&
      data.containsMatchCount / data.matchCount >= 0.5;
    const arrayContains =
      !containsDominant &&
      sourceProfile?.valueContainer === 'scalar' &&
      targetProfile?.valueContainer === 'array';
    const matchStrategy: RelationshipRuleMatchStrategy = containsDominant
      ? 'contains'
      : arrayContains
        ? 'array_contains'
        : sourceProfile?.dominantValueType === 'person_name' ||
            targetProfile?.dominantValueType === 'person_name'
          ? 'person_name_alias'
          : 'exact';

    const inferred = inferRelationshipType({
      sourceField,
      targetField,
      suggestionKind,
    });

    suggestions.push({
      sourceDatasourceId: suggestionSourceDatasourceId,
      sourceField,
      targetDatasourceId,
      targetField,
      matchCount: data.matchCount,
      sampleValues: [...data.sampleValues].slice(0, 5),
      suggestionKind,
      valueCounts: data.valueCounts,
      valueTypes: [...data.valueTypes.keys()],
      distinctMatchedValueCount: data.valueCounts.size,
      fuzzyMatchCount: data.fuzzyMatchCount,
      sourceFieldSemantic,
      targetFieldSemantic,
      topMatchedValues,
      matchStrategy,
      relationshipType: inferred.relationshipType,
      reciprocalRelationshipType: inferred.reciprocalRelationshipType,
    });
  }

  return deduplicateTargetFields(suggestions);
}

// No score exists yet at this stage (gates run before scoring) — dedupe and
// final ordering fall back to purely structural tie-breaks. The service
// re-sorts survivors by FS-scored probability once scoring runs.
function deduplicateTargetFields(
  suggestions: CandidateMatch[],
): CandidateMatch[] {
  const groups = new Map<string, CandidateMatch[]>();
  for (const suggestion of suggestions) {
    const valuesKey = [...suggestion.sampleValues].sort().join('\0');
    const key = `${suggestion.sourceDatasourceId ?? ''}|${suggestion.sourceField}|${suggestion.targetDatasourceId}|${suggestion.matchCount}|${valuesKey}`;
    groups.set(key, [...(groups.get(key) ?? []), suggestion]);
  }

  const result: CandidateMatch[] = [];
  for (const group of groups.values()) {
    if (group.length <= 1) {
      result.push(...group);
      continue;
    }
    group.sort(
      (a, b) =>
        a.targetField.split('.').length - b.targetField.split('.').length,
    );
    result.push(group[0]);
  }

  result.sort((a, b) => {
    if (b.matchCount !== a.matchCount) {
      return b.matchCount - a.matchCount;
    }
    if (a.sourceField !== b.sourceField) {
      return codepointCompare(a.sourceField, b.sourceField);
    }
    return codepointCompare(a.targetField, b.targetField);
  });
  return result;
}

// Codepoint comparison, not localeCompare: candidate order reaches the wire
// (suggestions, suppressed lists, topMatchedValues), so collation must not
// vary with the runtime's ICU/locale.
function codepointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildTargetProfilesFromObjects(
  targetObjectsByDatasource: Record<string, unknown[]>,
): Record<string, Record<string, FieldProfile>> {
  return buildTargetProfiles(targetObjectsByDatasource);
}
