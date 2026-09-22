import { useMemo } from 'react';
import type { OverviewConfig } from '../../overview';
import type { Capability } from '../../../api';

/**
 * Config-driven overview description for Capabilities.
 *
 * Capabilities are a flat list: no grouping (no sidebar sub-items) and no status
 * filters (the entity has no status field), so `group` and `statuses` are
 * omitted — the page renders no filter chips. Search spans name and description,
 * matching (and extending) the legacy name-only search.
 */
export function useCapabilitiesOverviewConfig(): OverviewConfig<Capability> {
  return useMemo<OverviewConfig<Capability>>(
    () => ({
      getId: c => c.id,
      searchFields: c => [c.name, c.description ?? null],
    }),
    [],
  );
}
