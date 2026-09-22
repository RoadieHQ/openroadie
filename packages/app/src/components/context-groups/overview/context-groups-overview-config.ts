import { useMemo } from 'react';
import type { OverviewConfig } from '../../overview';
import type { ContextGroupRule } from '../types';

/**
 * Config-driven overview description for Context Groups.
 *
 * Flat page — no grouping (no sidebar sub-items) and no status chips. Search
 * matches the rule name, preserving the legacy card-list search behaviour.
 */
export function useContextGroupsOverviewConfig(): OverviewConfig<ContextGroupRule> {
  return useMemo<OverviewConfig<ContextGroupRule>>(
    () => ({
      getId: rule => rule.id,
      searchFields: rule => [rule.name],
    }),
    [],
  );
}
