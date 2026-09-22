import React, { useCallback, useMemo } from 'react';
import { Database } from 'lucide-react';
import { ToggleGroup } from '@roadiehq/ui/toggle-group';
import { IntegrationSelector } from '../../../common/integration-selector';
import type { Integration } from '../../../integrations/types';
import { useDataSourceEditorContext } from '../data-source-editor-context';
import type { PickerComboboxGroup } from '../../../common/picker-combobox';
import { HttpSourceConfig } from './http-source-config';
import { AwsSourceConfig } from './aws-source-config';
import {
  DatastoreSourceConfig,
  DATASTORE_SOURCE_OPTION_ID,
} from './datastore-source-config';

export type SourceConfigType = 'http' | 'aws' | 'datastore' | null;

interface SourceConfigProps {
  config: Record<string, unknown>;
  sourceType: SourceConfigType;
  onChange: (field: string, value: unknown) => void;
  allowAccountTemplates?: boolean;
  onIntegrationSelect?: (
    integrationId: string,
    integration: Integration,
  ) => void;
  infoBanner?: React.ReactNode;
  afterContent?: React.ReactNode;
  integration?: Integration | null;
  onIntegrationUpdated?: (integration: Integration) => void;
  /** Offer "From another data source" in the picker (primary source only). */
  allowDatastoreSource?: boolean;
  onDatastoreSourceSelect?: () => void;
}

export function SourceConfig({
  config,
  sourceType,
  onChange,
  allowAccountTemplates = false,
  onIntegrationSelect,
  infoBanner,
  afterContent,
  integration,
  onIntegrationUpdated,
  allowDatastoreSource = false,
  onDatastoreSourceSelect,
}: SourceConfigProps) {
  const { workflowApi, workflowId, bumpSecretRefresh } =
    useDataSourceEditorContext();
  const handleSelect = useCallback(
    (selected: Integration) => {
      if (onIntegrationSelect) {
        onIntegrationSelect(selected.id, selected);
      } else {
        onChange('integrationId', selected.id);
        onChange('backendType', selected.backendType);
      }
    },
    [onChange, onIntegrationSelect],
  );

  const selectedIntegrationId =
    typeof config.integrationId === 'string' ? config.integrationId : undefined;
  const selectedPickerId =
    sourceType === 'datastore'
      ? DATASTORE_SOURCE_OPTION_ID
      : selectedIntegrationId;

  const datastoreSourceGroups = useMemo<PickerComboboxGroup[] | undefined>(
    () =>
      allowDatastoreSource
        ? [
            {
              label: 'Other sources',
              options: [
                {
                  id: DATASTORE_SOURCE_OPTION_ID,
                  label: 'From another data source',
                  icon: (
                    <Database
                      className="size-5 text-muted-foreground"
                      aria-hidden
                    />
                  ),
                },
              ],
            },
          ]
        : undefined,
    [allowDatastoreSource],
  );

  const handleSelectExtra = useCallback(
    (id: string) => {
      if (id === DATASTORE_SOURCE_OPTION_ID) {
        onDatastoreSourceSelect?.();
      }
    },
    [onDatastoreSourceSelect],
  );
  const loadOrganizationAccounts = useCallback(() => {
    if (!selectedIntegrationId) {
      return Promise.resolve([]);
    }

    return workflowApi.integrations.previewAwsOrganizationAccounts(
      selectedIntegrationId,
    );
  }, [selectedIntegrationId, workflowApi.integrations]);

  const httpMode = config.mode === 'graphql' ? 'graphql' : 'rest';
  const awsMode =
    config.mode === 'service-api' ? 'service-api' : 'cloud-control';
  const showHttpModeToggle =
    sourceType === 'http' && Boolean(integration?.graphqlPath);
  const showAwsModeToggle = sourceType === 'aws';

  const handleHttpModeChange = useCallback(
    (value: 'rest' | 'graphql') => {
      onChange('mode', value);
      if (value === 'graphql' && integration?.graphqlPath) {
        onChange('path', integration.graphqlPath);
        onChange('method', 'POST');
        onChange('pathTemplate', integration.graphqlPath);
        onChange('pathParams', {});
      } else if (value === 'rest') {
        onChange('method', 'GET');
      }
    },
    [integration?.graphqlPath, onChange],
  );

  const handleAwsModeChange = useCallback(
    (value: 'cloud-control' | 'service-api') => {
      onChange('mode', value);
      if (value === 'service-api') {
        if (!config.arrayExpression) {
          onChange('arrayExpression', '$');
        }
        if (!config.objectIdExpression) {
          onChange('objectIdExpression', 'id');
        }
        if (!config.pagination) {
          onChange('pagination', { type: 'none' });
        }
      }
    },
    [
      config.arrayExpression,
      config.objectIdExpression,
      config.pagination,
      onChange,
    ],
  );

  return (
    <div>
      {infoBanner}
      <div className="mb-4">
        <IntegrationSelector
          selectedIntegrationId={selectedPickerId}
          onSelect={handleSelect}
          listClient={workflowApi}
          autoFocusOnMount={!workflowId && !selectedPickerId}
          onSecretsRefreshed={bumpSecretRefresh}
          extraGroups={datastoreSourceGroups}
          onSelectExtra={handleSelectExtra}
          inputAdornment={
            showHttpModeToggle ? (
              <div data-testid="http-source-mode">
                <ToggleGroup
                  value={httpMode}
                  onValueChange={handleHttpModeChange}
                  items={[
                    { value: 'rest' as const, label: 'REST' },
                    { value: 'graphql' as const, label: 'GraphQL' },
                  ]}
                  aria-label="REST or GraphQL"
                  size="lg"
                  className="motion-nested-button-colors rounded-lg border border-border bg-card p-1 shadow-sm [&_button]:rounded-md [&_button]:border-0 [&_button]:px-3.5 [&_button]:text-sm [&_button]:font-medium [&_button]:text-foreground/60 [&_button:hover]:text-foreground [&_button[aria-checked=true]]:bg-primary/10 [&_button[aria-checked=true]]:font-semibold [&_button[aria-checked=true]]:text-primary dark:[&_button[aria-checked=true]]:bg-primary/20 dark:[&_button[aria-checked=true]]:text-primary"
                />
              </div>
            ) : showAwsModeToggle ? (
              <div data-testid="aws-source-mode">
                <ToggleGroup
                  value={awsMode}
                  onValueChange={handleAwsModeChange}
                  items={[
                    {
                      value: 'cloud-control' as const,
                      label: 'Cloud Control',
                      tooltip:
                        'Uses the AWS Cloud Control API — a standardised interface that covers most AWS resource types. Recommended for the majority of use cases.',
                    },
                    {
                      value: 'service-api' as const,
                      label: 'Service API',
                      tooltip:
                        'Uses service-specific AWS APIs. Choose this when the resource type you need is not yet supported by Cloud Control.',
                    },
                  ]}
                  aria-label="Cloud Control or Service API"
                  size="lg"
                  className="motion-nested-button-colors rounded-lg border border-border bg-card p-1 shadow-sm [&_button]:rounded-md [&_button]:border-0 [&_button]:px-3.5 [&_button]:text-sm [&_button]:font-medium [&_button]:text-foreground/60 [&_button:hover]:text-foreground [&_button[aria-checked=true]]:bg-primary/10 [&_button[aria-checked=true]]:font-semibold [&_button[aria-checked=true]]:text-primary dark:[&_button[aria-checked=true]]:bg-primary/20 dark:[&_button[aria-checked=true]]:text-primary"
                />
              </div>
            ) : undefined
          }
        />
      </div>

      {sourceType === 'http' && (
        <HttpSourceConfig
          config={config}
          onChange={onChange}
          integration={integration}
          onIntegrationUpdated={onIntegrationUpdated}
        />
      )}
      {sourceType === 'aws' && (
        <AwsSourceConfig
          config={config}
          onChange={onChange}
          integration={integration}
          allowAccountTemplates={allowAccountTemplates}
          selectedIntegrationId={selectedIntegrationId}
          loadOrganizationAccounts={
            selectedIntegrationId ? loadOrganizationAccounts : undefined
          }
        />
      )}
      {sourceType === 'datastore' && allowDatastoreSource && (
        <DatastoreSourceConfig config={config} onChange={onChange} />
      )}

      {afterContent}
    </div>
  );
}
