/**
 * What else breaks when a data source is deleted, beyond `@datasource:` tokens
 * in capability instructions (see `capabilities/reference-usage`).
 */

import type { ContextGroupRule } from '../context-groups/types';

export interface DependentRef {
  id: string;
  name: string;
}

/**
 * Context-group rules that draw from `dataSourceId`.
 *
 * A rule may name its source either directly (`datasourceId`) or through a seed
 * (`seedName`). The seed form is resolved server-side into
 * `status.datasourceId`, so both must be checked — matching on `datasourceId`
 * alone silently misses every seed-backed rule.
 */
export function findContextGroupRulesForDataSource(
  rules: readonly ContextGroupRule[],
  dataSourceId: string,
): DependentRef[] {
  return rules
    .filter(rule =>
      rule.datasources.some(
        filter =>
          filter.datasourceId === dataSourceId ||
          filter.status?.datasourceId === dataSourceId,
      ),
    )
    .map(rule => ({ id: rule.id, name: rule.name }));
}
