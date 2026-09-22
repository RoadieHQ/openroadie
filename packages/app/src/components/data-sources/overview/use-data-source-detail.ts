import { useQuery } from '@tanstack/react-query';
import { useDatastore } from '../../../api';
import {
  dataSourceDetailQuery,
  type DataSourceDetail,
  type DataSourceRelationshipRule,
} from '../../../api/queries';

export type { DataSourceDetail, DataSourceRelationshipRule };

export interface UseDataSourceDetailResult {
  detail: DataSourceDetail | undefined;
  loading: boolean;
  error: Error | null;
}

/**
 * On-demand detail for the Data Sources drawer: an object preview plus the
 * cross-cutting counts (objects, relationships, context-group membership) that
 * don't live on the list row. Only fetches while `dataSourceId` is non-null
 * (i.e. the drawer is open).
 */
export function useDataSourceDetail(
  dataSourceId: string | null,
): UseDataSourceDetailResult {
  const datastore = useDatastore();

  const query = useQuery({
    ...dataSourceDetailQuery(datastore, dataSourceId ?? ''),
    enabled: dataSourceId != null,
  });

  return {
    detail: query.data,
    loading: query.isLoading,
    error: query.error,
  };
}
