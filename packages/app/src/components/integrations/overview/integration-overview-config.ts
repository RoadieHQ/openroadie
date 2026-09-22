import { useMemo } from 'react';
import type { OverviewConfig } from '../../overview';
import type { IntegrationItem } from '../types';
import { INTEGRATION_TYPE_META } from '../types';
import { isSecretsReadyForList } from '../secret-readiness';
import type { IntegrationSecretSummary } from '../use-integration-secret-status';

/** Resolve the category meta for an integration type, defaulting to `other`. */
function getTypeMeta(type: string) {
  if (Object.hasOwn(INTEGRATION_TYPE_META, type)) {
    return INTEGRATION_TYPE_META[type as keyof typeof INTEGRATION_TYPE_META];
  }
  return INTEGRATION_TYPE_META.other;
}

export interface UseIntegrationOverviewConfigParams {
  /** Secret readiness summaries keyed by integration id. */
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>;
  /** Whether secret readiness is still resolving. */
  secretStatusLoading: boolean;
  /** Category logo data URIs keyed by logo slug (for sidebar sub-items). */
  logoDataUriBySlug: Map<string, string>;
}

/**
 * Config-driven overview description for Integrations.
 *
 * - Groups by category (the fixed, ordered {@link INTEGRATION_TYPE_META} set;
 *   `useOverviewState` shows only non-empty categories plus a synthesised `All`).
 *   These become the sidebar sub-items when the page is standalone.
 * - Status chips: Needs setup / Ready (plus the synthesised `All`). Needs-setup
 *   is listed first to surface integrations awaiting configuration.
 * - Search spans name, description, slug, host, and the category label, matching
 *   the legacy search behaviour.
 *
 * Memoised on the secret summaries + loading flag so the readiness predicate
 * stays current without recreating the config on unrelated renders.
 */
export function useIntegrationOverviewConfig({
  summariesByIntegrationId,
  secretStatusLoading,
  logoDataUriBySlug,
}: UseIntegrationOverviewConfigParams): OverviewConfig<IntegrationItem> {
  return useMemo<OverviewConfig<IntegrationItem>>(() => {
    const isReady = (item: IntegrationItem): boolean =>
      isSecretsReadyForList(
        item,
        summariesByIntegrationId.get(item.id),
        secretStatusLoading,
      );

    return {
      getId: item => item.id,
      searchFields: item => [
        item.name,
        item.description,
        item.slug,
        item.host,
        getTypeMeta(item.type).label,
      ],
      group: {
        kind: 'fixed',
        key: item =>
          Object.hasOwn(INTEGRATION_TYPE_META, item.type) ? item.type : 'other',
        label: item => getTypeMeta(item.type).label,
        keys: Object.entries(INTEGRATION_TYPE_META).map(([key, meta]) => ({
          key,
          label: meta.label,
          logoUrl: logoDataUriBySlug.get(meta.logoSlug),
        })),
      },
      statuses: [
        {
          value: 'needs-setup',
          label: 'Needs setup',
          predicate: item => !isReady(item),
        },
        {
          value: 'ready',
          label: 'Ready',
          predicate: item => isReady(item),
        },
      ],
    };
  }, [summariesByIntegrationId, secretStatusLoading, logoDataUriBySlug]);
}
