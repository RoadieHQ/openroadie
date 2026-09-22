import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDatastore } from '../../api';
import { relationshipRulesAllQuery } from '../../api/queries';

/** Map of relationship-rule id → rule name, for labeling edge provenance. */
export function useRelationshipRuleNames(): Map<string, string> {
  const api = useDatastore();
  const { data } = useQuery(relationshipRulesAllQuery(api));
  return useMemo(() => {
    const names = new Map<string, string>();
    for (const rule of data?.items ?? []) {
      names.set(rule.id, rule.name);
    }
    return names;
  }, [data]);
}
