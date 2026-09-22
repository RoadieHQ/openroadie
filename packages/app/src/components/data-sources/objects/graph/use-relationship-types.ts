import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useDatastore } from '../../../../api';
import { relationshipTypesQuery } from '../../../../api/queries';

/** Distinct relationship types within the datasource scope (filter facet). */
export function useRelationshipTypes(datasourceIds: readonly string[]): {
  types: string[];
  loading: boolean;
} {
  const api = useDatastore();
  const query = useQuery({
    ...relationshipTypesQuery(api, datasourceIds),
    placeholderData: keepPreviousData,
  });
  return { types: query.data ?? [], loading: query.isPending };
}
