import { useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Integration } from '../../api/workflow/workflow-client';
import { useWorkflows } from '../../api';
import { logosCatalogQuery } from '../../api/queries';
import { INTEGRATION_TYPE_META } from '../integrations/types';

/**
 * Returns a function that resolves an integration's logo to a data URI
 * using the logos catalog + logoSlug, matching the same logic the
 * data-source list uses. Without this, `integration.logoUrl` may point
 * at a backend proxy URL that serves a wrong/generic/stale image.
 */
export function useLogoResolver() {
  const api = useWorkflows();
  const { data: logos } = useQuery(logosCatalogQuery(api));

  const logoDataUriBySlug = useMemo(
    () =>
      new Map(
        (logos ?? []).map(l => [
          l.slug,
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(l.svg)}`,
        ]),
      ),
    [logos],
  );

  return useCallback(
    (
      integration:
        | (Pick<Integration, 'logoUrl' | 'type'> & { logoSlug?: string })
        | undefined,
    ): string => {
      if (!integration) return '';
      if (integration.logoUrl.startsWith('data:')) return integration.logoUrl;
      const slugLogo = integration.logoSlug
        ? logoDataUriBySlug.get(integration.logoSlug)
        : undefined;
      const categoryMeta =
        INTEGRATION_TYPE_META[integration.type] ?? INTEGRATION_TYPE_META.other;
      const categoryLogo = logoDataUriBySlug.get(categoryMeta.logoSlug);
      return slugLogo ?? categoryLogo ?? '';
    },
    [logoDataUriBySlug],
  );
}
