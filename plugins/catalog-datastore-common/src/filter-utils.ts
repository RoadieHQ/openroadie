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

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than';

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: string;
}

export function parseFilterConditions(filter?: string): FilterCondition[] {
  if (!filter) return [];
  try {
    return JSON.parse(filter) as FilterCondition[];
  } catch {
    return [];
  }
}

export function serializeFilterConditions(
  conditions: FilterCondition[],
): string | undefined {
  const valid = conditions.filter(c => c.field.trim() && c.value.trim());
  return valid.length > 0 ? JSON.stringify(valid) : undefined;
}

export function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[`${part}`];
  }
  return current;
}

export function evaluateCondition(
  obj: unknown,
  condition: FilterCondition,
): boolean {
  const fieldValue = getNestedValue(obj, condition.field);
  if (fieldValue === undefined || fieldValue === null) {
    return condition.operator === 'not_equals';
  }

  const strValue = String(fieldValue);
  const compareValue = condition.value;

  switch (condition.operator) {
    case 'equals':
      return strValue === compareValue;
    case 'not_equals':
      return strValue !== compareValue;
    case 'contains':
      return strValue.includes(compareValue);
    case 'starts_with':
      return strValue.startsWith(compareValue);
    case 'ends_with':
      return strValue.endsWith(compareValue);
    case 'greater_than':
    case 'less_than': {
      const fieldNumber = Number(strValue);
      const compareNumber = Number(compareValue);
      if (!Number.isFinite(fieldNumber) || !Number.isFinite(compareNumber)) {
        return false;
      }
      return condition.operator === 'greater_than'
        ? fieldNumber > compareNumber
        : fieldNumber < compareNumber;
    }
    default:
      return true;
  }
}

export function objectMatchesFilters(
  obj: unknown,
  conditions: FilterCondition[],
): boolean {
  if (conditions.length === 0) return true;
  return conditions.every(condition => evaluateCondition(obj, condition));
}

export function objectMatchesFilterString(
  obj: unknown,
  filterString?: string,
): boolean {
  const conditions = parseFilterConditions(filterString);
  return objectMatchesFilters(obj, conditions);
}
