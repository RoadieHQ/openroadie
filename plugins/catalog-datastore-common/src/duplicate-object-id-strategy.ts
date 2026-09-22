/*
 * Copyright 2026 Larder Software Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { JsonObject, JsonValue } from '@roadiehq/types';

export const DUPLICATE_OBJECT_ID_STRATEGIES = [
  'fail',
  'keep_last',
  'append',
  'expand',
] as const;

export type DuplicateObjectIdStrategy =
  (typeof DUPLICATE_OBJECT_ID_STRATEGIES)[number];

export const DEFAULT_DUPLICATE_OBJECT_ID_STRATEGY: DuplicateObjectIdStrategy =
  'fail';

/**
 * Suffix between base objectId and occurrence index for `expand` (ASCII unit separator).
 * First row for an index keeps the base id; further rows use `${base}${SEP}${n}`.
 */
export const DUPLICATE_OBJECT_ID_EXPAND_SEP = '\u001f';

export const ADDITIONAL_DEDUPLICATION_RESULTS_FIELD = 'additionalResults';

/** Missing or non-enum → default. Expects exact enum strings (UI / workflow JSON). */
export function parseDuplicateObjectIdStrategy(
  v: unknown,
): DuplicateObjectIdStrategy {
  if (typeof v === 'string') {
    for (const strategy of DUPLICATE_OBJECT_ID_STRATEGIES) {
      if (strategy === v) {
        return strategy;
      }
    }
  }
  return DEFAULT_DUPLICATE_OBJECT_ID_STRATEGY;
}

/**
 * Canonical form for comparing / storing datastore object ids: trim whitespace
 * and Unicode NFC so the same logical index value dedupes (e.g. composed vs
 * decomposed accents, stray spaces).
 */
export function normalizeDatastoreObjectIdKey(id: string): string {
  return id.trim().normalize('NFC');
}

export type ResolveDuplicateObjectIdsOptions = {
  /** When strategy is fail, included in the error (e.g. JSONata index expression). */
  indexExpression?: string;
};

function collectDuplicateObjectIds<T extends { objectId: string }>(
  items: T[],
): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const item of items) {
    if (seen.has(item.objectId)) {
      dups.add(item.objectId);
    }
    seen.add(item.objectId);
  }
  return Array.from(dups).sort();
}

function isJsonObject(v: JsonValue): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function itemHasDatastoreObject(item: {
  objectId: string;
}): item is { objectId: string; object: JsonObject } {
  return (
    'object' in item && isJsonObject((item as { object: JsonValue }).object)
  );
}

function mergeAppendGroup<T extends { objectId: string }>(group: T[]): T {
  if (group.length === 1) {
    return group[0];
  }
  const [first, ...rest] = group;
  if (!itemHasDatastoreObject(first)) {
    return group[group.length - 1];
  }
  const mergedObject: JsonObject = { ...first.object };
  const appendedObjects: JsonObject[] = [];
  for (const item of rest) {
    if (itemHasDatastoreObject(item)) {
      appendedObjects.push(item.object);
    }
  }
  if (appendedObjects.length === 0) {
    return { ...first, object: mergedObject };
  }
  const prior = mergedObject[ADDITIONAL_DEDUPLICATION_RESULTS_FIELD];
  let priorEntries: JsonValue[];
  if (Array.isArray(prior)) {
    priorEntries = [...prior];
  } else if (prior !== undefined) {
    priorEntries = [prior];
  } else {
    priorEntries = [];
  }
  mergedObject[ADDITIONAL_DEDUPLICATION_RESULTS_FIELD] = [
    ...priorEntries,
    ...appendedObjects,
  ];
  return { ...first, object: mergedObject };
}

/**
 * Applies duplicate objectId handling for datastore replace / sink flows.
 *
 * @throws Error when strategy is fail and duplicate objectIds exist
 */
export function resolveDatastoreItemsByObjectIdStrategy<
  T extends { objectId: string },
>(
  items: T[],
  strategy: DuplicateObjectIdStrategy,
  options?: ResolveDuplicateObjectIdsOptions,
): { items: T[]; removed: number; duplicateObjectIds: string[] } {
  const normalizedItems = items.map(item => ({
    ...item,
    objectId: normalizeDatastoreObjectIdKey(item.objectId),
  }));

  const duplicateObjectIds = collectDuplicateObjectIds(normalizedItems);
  if (duplicateObjectIds.length === 0) {
    return { items: normalizedItems, removed: 0, duplicateObjectIds: [] };
  }

  switch (strategy) {
    case 'fail': {
      const list = duplicateObjectIds.slice(0, 20).join(', ');
      const suffix = duplicateObjectIds.length > 20 ? '…' : '';
      const compoundHint =
        'Prefer a compound unique index (JSONata), e.g. $string(_parent.id) & "-" & $string($.id). Or set collision handling to keep one row per index, append (extra rows under additionalResults), or expand (compound keys).';
      if (options?.indexExpression) {
        throw new Error(
          `Index expression "${options.indexExpression}" produced duplicate ${
            duplicateObjectIds.length > 1 ? 'values' : 'value'
          }: ${list}${suffix}. ${compoundHint}`,
        );
      }
      throw new Error(
        `Duplicate objectId values: ${list}${suffix}. ${compoundHint}`,
      );
    }
    case 'keep_last': {
      const byId = new Map<string, T>();
      for (const item of normalizedItems) {
        byId.set(item.objectId, item);
      }
      return {
        items: Array.from(byId.values()),
        removed: normalizedItems.length - byId.size,
        duplicateObjectIds,
      };
    }
    case 'append': {
      const groups = new Map<string, T[]>();
      for (const item of normalizedItems) {
        const list = groups.get(item.objectId);
        if (list) {
          list.push(item);
        } else {
          groups.set(item.objectId, [item]);
        }
      }
      const resolvedItems: T[] = [];
      let removed = 0;
      for (const group of Array.from(groups.values())) {
        if (group.length === 1) {
          resolvedItems.push(group[0]);
        } else {
          removed += group.length - 1;
          resolvedItems.push(mergeAppendGroup(group));
        }
      }
      return { items: resolvedItems, removed, duplicateObjectIds };
    }
    case 'expand': {
      const countsById = new Map<string, number>();
      const resolvedItems: T[] = [];
      for (const item of normalizedItems) {
        const base = item.objectId;
        const n = countsById.get(base) ?? 0;
        countsById.set(base, n + 1);
        const newObjectId =
          n === 0 ? base : `${base}${DUPLICATE_OBJECT_ID_EXPAND_SEP}${n}`;
        resolvedItems.push({ ...item, objectId: newObjectId });
      }
      return {
        items: resolvedItems,
        removed: 0,
        duplicateObjectIds,
      };
    }
    default: {
      const _exhaustive: never = strategy;
      throw new Error(
        `Unexpected duplicate object id strategy: ${_exhaustive}`,
      );
    }
  }
}
