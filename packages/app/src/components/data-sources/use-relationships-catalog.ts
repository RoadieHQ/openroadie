import { useMemo } from 'react';
import type { DatastoreSchema } from '../../api/datastore/datastore-client';
import { useDatastoreSchemas } from './use-datastore-schemas';
import { useDataSources } from './use-data-sources';
import { useRelationshipRules } from './use-relationship-rules';

interface UseRelationshipsCatalogOptions {
  /** Passed through to {@link useDataSources}. */
  skipExecutions?: boolean;
}

/**
 * Loads data sources + schemas + relationship rules once for Relationships UIs that
 * need the catalog (embedded graph page, standalone suggestions / edit routes).
 */
export function useRelationshipsCatalog(
  options?: UseRelationshipsCatalogOptions,
) {
  const skipExecutions = options?.skipExecutions ?? true;

  const {
    dataSources,
    loading: dataSourcesLoading,
    error: dataSourcesError,
    refetch: refetchDataSources,
  } = useDataSources({ skipExecutions });
  const {
    schemas,
    loading: schemasLoading,
    error: schemasError,
  } = useDatastoreSchemas(true);
  const {
    rules,
    loading: rulesLoading,
    error: rulesError,
  } = useRelationshipRules(true);

  const enabledDataSources = useMemo(
    () => dataSources.filter(ds => ds.enabled),
    [dataSources],
  );

  const datasourceLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const ds of dataSources) {
      map.set(ds.id, ds.name);
    }
    return map;
  }, [dataSources]);

  const schemaByDatasourceId = useMemo(() => {
    const map = new Map<string, DatastoreSchema>();
    for (const schema of schemas) {
      map.set(schema.datasourceId, schema);
    }
    return map;
  }, [schemas]);

  return {
    dataSources,
    schemas,
    rules,
    enabledDataSources,
    datasourceLabels,
    schemaByDatasourceId,
    loading: dataSourcesLoading || schemasLoading || rulesLoading,
    error: dataSourcesError ?? schemasError ?? rulesError ?? null,
    refetchDataSources,
  };
}
