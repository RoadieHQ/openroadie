import {
  INTEGRATION_TYPES,
  type IntegrationType,
} from '../integrations/constants';

export type CategoryFilter = 'all' | IntegrationType;

export const CATEGORY_FILTER_VALUES = new Set<CategoryFilter>([
  'all',
  ...INTEGRATION_TYPES.map(t => t.value),
]);

export function parseCategoryFilter(value: string | null): CategoryFilter {
  if (value && CATEGORY_FILTER_VALUES.has(value as CategoryFilter)) {
    return value as CategoryFilter;
  }
  return 'all';
}
