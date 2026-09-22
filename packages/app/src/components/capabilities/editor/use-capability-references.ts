import { useMemo } from 'react';
import { useDataSources } from '../../data-sources/use-data-sources';
import { useActions } from '../../actions/use-actions';
import { useContextGroups } from '../../context-groups/use-context-groups';
import { useCapabilities } from '../use-capabilities';
import { type CapabilityReference, referenceKey } from './references';

interface UseCapabilityReferencesResult {
  references: CapabilityReference[];
  /** Lookup keyed by `type:slug` for resolving tokens to their display name. */
  byKey: Map<string, CapabilityReference>;
  loading: boolean;
}

/**
 * Aggregates every resource that can be `@`-referenced in a capability —
 * data sources, actions, context groups and other capabilities — into a single
 * flat list keyed by its `type:slug` token. Reuses the existing feature data
 * hooks.
 */
export function useCapabilityReferences(): UseCapabilityReferencesResult {
  const { dataSources, loading: dataSourcesLoading } = useDataSources({
    skipExecutions: true,
  });
  const { actions, loading: actionsLoading } = useActions();
  const { rules, loading: rulesLoading } = useContextGroups();
  const { capabilities, loading: capabilitiesLoading } = useCapabilities();

  const references = useMemo<CapabilityReference[]>(() => {
    const items: CapabilityReference[] = [];

    for (const ds of dataSources) {
      if (ds.slug) {
        items.push({
          type: 'datasource',
          slug: ds.slug,
          name: ds.name,
          id: ds.id,
        });
      }
    }
    for (const action of actions) {
      if (action.slug) {
        items.push({
          type: 'action',
          slug: action.slug,
          name: action.name,
          id: action.id,
        });
      }
    }
    for (const rule of rules) {
      if (rule.slug) {
        items.push({
          type: 'context-group',
          slug: rule.slug,
          name: rule.name,
          id: rule.id,
        });
      }
    }
    for (const capability of capabilities) {
      if (capability.slug) {
        items.push({
          type: 'capability',
          slug: capability.slug,
          name: capability.name,
          id: capability.id,
        });
      }
    }

    return items;
  }, [dataSources, actions, rules, capabilities]);

  const byKey = useMemo(() => {
    const map = new Map<string, CapabilityReference>();
    for (const ref of references) {
      map.set(referenceKey(ref.type, ref.slug), ref);
    }
    return map;
  }, [references]);

  return {
    references,
    byKey,
    loading:
      dataSourcesLoading ||
      actionsLoading ||
      rulesLoading ||
      capabilitiesLoading,
  };
}
