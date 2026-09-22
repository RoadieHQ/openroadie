import { useMemo } from 'react';
import { LIFECYCLE } from '../../overview';
import type { OverviewConfig } from '../../overview';
import type { ActionWithSchema } from '../types';

/**
 * Config-driven overview description for Actions.
 *
 * - Flat page: no grouping (no sidebar sub-items).
 * - Status chips: Enabled / Disabled (plus the synthesised `All`).
 * - Search spans name and slug, matching the legacy search behaviour.
 */
export function useActionsOverviewConfig(): OverviewConfig<ActionWithSchema> {
  return useMemo<OverviewConfig<ActionWithSchema>>(
    () => ({
      getId: action => action.id,
      searchFields: action => [action.name, action.slug],
      statuses: [
        {
          value: 'enabled',
          label: LIFECYCLE.enabled.label,
          predicate: action => action.enabled,
        },
        {
          value: 'disabled',
          label: LIFECYCLE.disabled.label,
          predicate: action => !action.enabled,
        },
      ],
    }),
    [],
  );
}
