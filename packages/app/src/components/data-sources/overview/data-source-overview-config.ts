import { useMemo } from 'react';
import { LayoutGrid, Star } from 'lucide-react';
import type { OverviewConfig } from '../../overview';
import type { DataSourceItem } from '../types';
import { INTEGRATION_TYPE_META } from '../../integrations/types';
import {
  dataSourceNeedsIntegrationSetup,
  dataSourceNeedsSourceSetup,
} from '../data-source-status';
import { isDataSourceConfigurationReady } from '../readiness';
import type { IntegrationSecretSummary } from '../../integrations/use-integration-secret-status';

/**
 * Category key for a data source's integration, defaulting to `other`. Uses the
 * same fixed {@link INTEGRATION_TYPE_META} taxonomy as the Integrations page so
 * both overviews share one bounded set of sidebar categories (Source Control,
 * CI / CD, …) rather than an unbounded per-integration list.
 */
function getCategoryKey(ds: DataSourceItem): string {
  const type = ds.integration?.type;
  return type && Object.hasOwn(INTEGRATION_TYPE_META, type) ? type : 'other';
}

/** Human label for a data source's integration category. */
function getCategoryLabel(ds: DataSourceItem): string {
  return INTEGRATION_TYPE_META[getCategoryKey(ds)].label;
}

/**
 * Config-driven overview description for Data Sources.
 *
 * - Groups by integration **category** (the fixed, ordered
 *   {@link INTEGRATION_TYPE_META} set; `useOverviewState` shows only non-empty
 *   categories plus a synthesised `All`), matching the Integrations page. A
 *   virtual `Favorites` sub-item is rendered between `All` and the categories.
 * - Status filter: Enabled / Disabled / Needs integration setup / Needs setup.
 *   Execution outcomes are deliberately excluded and belong to the Run column.
 * - Search spans name, description, the integration's label/slug/type, and the
 *   category label.
 *
 * Memoised on secret summaries + loading so readiness predicates stay current
 * without recreating the config on unrelated renders.
 */
export function useDataSourceOverviewConfig(
  favoriteIds: ReadonlySet<string>,
  logoDataUriBySlug: Map<string, string>,
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
  secretStatusLoading: boolean,
): OverviewConfig<DataSourceItem> {
  return useMemo<OverviewConfig<DataSourceItem>>(
    () => ({
      getId: ds => ds.id,
      searchFields: ds => [
        ds.name,
        ds.description,
        ds.integration?.label,
        ds.integration?.slug,
        ds.integration?.type,
        getCategoryLabel(ds),
      ],
      group: {
        kind: 'fixed',
        key: getCategoryKey,
        label: getCategoryLabel,
        allIcon: LayoutGrid,
        keys: Object.entries(INTEGRATION_TYPE_META).map(([key, meta]) => ({
          key,
          label: meta.label,
          logoUrl: logoDataUriBySlug.get(meta.logoSlug),
        })),
        virtual: [
          {
            key: 'favorites',
            label: 'Favorites',
            predicate: ds => favoriteIds.has(ds.id),
            icon: Star,
            // Always present as a landing view, even with no favourites yet.
            alwaysShow: true,
          },
        ],
      },
      statuses: [
        {
          value: 'ready',
          label: 'Ready',
          showInFilter: false,
          predicate: ds =>
            isDataSourceConfigurationReady(
              ds,
              summariesByIntegrationId,
              secretStatusLoading,
            ),
        },
        {
          value: 'enabled',
          label: 'Enabled',
          predicate: ds =>
            ds.enabled &&
            isDataSourceConfigurationReady(
              ds,
              summariesByIntegrationId,
              secretStatusLoading,
            ),
        },
        {
          value: 'disabled',
          label: 'Disabled',
          predicate: ds =>
            !ds.enabled &&
            isDataSourceConfigurationReady(
              ds,
              summariesByIntegrationId,
              secretStatusLoading,
            ),
        },
        {
          value: 'needs-integration-setup',
          label: 'Needs integration setup',
          predicate: ds =>
            dataSourceNeedsIntegrationSetup(
              ds,
              summariesByIntegrationId,
              secretStatusLoading,
            ),
        },
        {
          value: 'needs-source-setup',
          label: 'Needs setup',
          predicate: ds =>
            dataSourceNeedsSourceSetup(
              ds,
              summariesByIntegrationId,
              secretStatusLoading,
            ),
        },
        {
          value: 'any-setup',
          label: 'Needs setup (all)',
          showInFilter: false,
          predicate: ds =>
            !isDataSourceConfigurationReady(
              ds,
              summariesByIntegrationId,
              secretStatusLoading,
            ),
        },
      ],
    }),
    [
      favoriteIds,
      logoDataUriBySlug,
      summariesByIntegrationId,
      secretStatusLoading,
    ],
  );
}
