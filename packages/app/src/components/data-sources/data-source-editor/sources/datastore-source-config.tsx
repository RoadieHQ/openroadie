import React, { useCallback, useMemo } from 'react';
import { Spinner } from '@roadiehq/ui/spinner';
import { Alert, AlertDescription } from '@roadiehq/ui/alert';
import { useDataSources } from '../../use-data-sources';
import { DataSourcePicker } from '../../data-source-picker';
import { useDataSourceEditorContext } from '../data-source-editor-context';

/** Synthetic picker option id for "From another data source". */
export const DATASTORE_SOURCE_OPTION_ID = 'datastore-source';

interface DatastoreSourceConfigProps {
  config: Record<string, unknown>;
  onChange: (field: string, value: unknown) => void;
}

export function DatastoreSourceConfig({
  config,
  onChange,
}: DatastoreSourceConfigProps) {
  const { workflowId } = useDataSourceEditorContext();
  const { dataSources, loading, error } = useDataSources({
    skipExecutions: true,
  });

  const options = useMemo(
    () =>
      dataSources
        .filter(ds => ds.id !== workflowId)
        .map(ds => ({ id: ds.id, name: ds.name, logoUrl: ds.logoUrl })),
    [dataSources, workflowId],
  );

  const datasourceId =
    typeof config.datasourceId === 'string' ? config.datasourceId : undefined;

  const handleSelect = useCallback(
    (id: string) => {
      onChange('datasourceId', id);
      const selected = dataSources.find(ds => ds.id === id);
      onChange('datasourceName', selected?.name ?? '');
    },
    [onChange, dataSources],
  );

  return (
    <div className="flex flex-col gap-4">
      {loading && (
        <div className="flex items-center gap-2">
          <Spinner size={16} />
          <span className="text-sm text-muted-foreground">
            Loading data sources...
          </span>
        </div>
      )}
      {!loading && error && (
        <Alert variant="destructive">
          <AlertDescription>
            {error instanceof Error ? error.message : String(error)}
          </AlertDescription>
        </Alert>
      )}
      {!loading && !error && (
        <DataSourcePicker
          dataSources={options}
          value={datasourceId}
          onChange={handleSelect}
          label="Data source"
          ariaLabel="Data source"
          data-testid="datastore-source-picker"
        />
      )}
    </div>
  );
}
