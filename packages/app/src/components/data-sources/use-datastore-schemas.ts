import { useQuery } from '@tanstack/react-query';
import { useDatastore } from '../../api';
import { datastoreSchemasQuery } from '../../api/queries';

export function useDatastoreSchemas(enabled: boolean) {
  const api = useDatastore();

  const { data, isLoading, error } = useQuery({
    ...datastoreSchemasQuery(api),
    enabled,
  });

  return {
    schemas: data?.items ?? [],
    loading: enabled && isLoading,
    error: error ?? undefined,
  };
}
