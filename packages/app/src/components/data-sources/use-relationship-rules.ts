import { useQuery } from '@tanstack/react-query';
import type { RelationshipRule } from '../../api/datastore/datastore-client';
import { useDatastore } from '../../api';
import { relationshipRulesQuery } from '../../api/queries';

const NO_RULES: RelationshipRule[] = [];

export function useRelationshipRules(enabled: boolean) {
  const api = useDatastore();

  const {
    data: value,
    isLoading: loading,
    error,
  } = useQuery({
    ...relationshipRulesQuery(api, 5000),
    enabled,
  });

  return {
    rules: value?.items ?? NO_RULES,
    loading: enabled && loading,
    error: error ?? undefined,
  };
}
