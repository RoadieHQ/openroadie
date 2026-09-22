import React, { useMemo, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, LayoutGrid, List } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { Alert, AlertDescription } from '@roadiehq/ui/alert';
import { Button } from '@roadiehq/ui/button';
import { SourceConfig, SourceConfigType } from './source-config';
import { useDataSourceEditorContext } from '../data-source-editor-context';
import type { Integration } from '../../../integrations/types';
import { queryKeys } from '../../../../api/queries';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../../../api/workspace-scope';
import { useIntegrationDetail } from '../use-integration-detail';

interface ChainedSourceConfigProps {
  config: Record<string, unknown>;
  sourceType: SourceConfigType;
  onChange: (field: string, value: unknown) => void;
  previousOutput?: unknown[];
  integration?: Integration | null;
}

export function getChainedSourceName(config: Record<string, unknown>): string {
  if (typeof config.name === 'string' && config.name) {
    return config.name;
  }
  if (typeof config.operation === 'string' && config.operation) {
    return config.operation;
  }
  if (typeof config.resourceType === 'string' && config.resourceType) {
    const parts = config.resourceType.split('::');
    return parts[parts.length - 1] || 'resources';
  }
  if (typeof config.path === 'string' && config.path) {
    const segments = config.path.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || 'data';
    return (
      lastSegment.replace(/\{\{[^}]+\}\}/g, '').replace(/[^a-zA-Z0-9]/g, '') ||
      'data'
    );
  }
  return 'data';
}

function getAvailableFields(items: unknown[]): string[] {
  const fieldSet = new Set<string>();
  const sample = items.slice(0, 5);
  for (const item of sample) {
    if (item && typeof item === 'object') {
      collectFields(item as Record<string, unknown>, '', fieldSet);
    }
  }
  return Array.from(fieldSet).sort();
}

function collectFields(
  obj: Record<string, unknown>,
  prefix: string,
  fields: Set<string>,
) {
  for (const [key, value] of Object.entries(obj)) {
    if (key === '_additionalData') {
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      collectFields(value as Record<string, unknown>, path, fields);
    } else {
      fields.add(path);
    }
  }
}

export function ChainedSourceConfig({
  config,
  sourceType,
  onChange,
  previousOutput,
  integration: integrationFromParent,
}: ChainedSourceConfigProps) {
  const workspaceScopeKey = getWorkspaceScopeKey();
  const { workflowApi } = useDataSourceEditorContext();
  const queryClient = useQueryClient();
  const [infoExpanded, setInfoExpanded] = useState(false);

  // When the parent supplies the integration, use it; otherwise fetch it by id.
  const integrationIdStr =
    !integrationFromParent && typeof config.integrationId === 'string'
      ? config.integrationId
      : undefined;
  const integrationQuery = useIntegrationDetail(workflowApi, integrationIdStr);
  const integration = integrationFromParent ?? integrationQuery.data ?? null;
  const resolvedSourceType = useMemo<SourceConfigType>(() => {
    if (integration?.backendType === 'aws') {
      return 'aws';
    }
    if (integration) {
      return 'http';
    }
    return sourceType;
  }, [integration, sourceType]);
  const itemCount = previousOutput?.length ?? 0;
  const availableFields = useMemo(
    () => (previousOutput ? getAvailableFields(previousOutput) : []),
    [previousOutput],
  );

  const handleIntegrationSelect = useCallback(
    (integrationId: string, selectedIntegration: Integration) => {
      // Seed the detail cache so the picked integration renders instantly
      // instead of flashing empty while the id-keyed query refetches.
      queryClient.setQueryData(
        queryKeys.integrationDetail(integrationId),
        selectedIntegration,
      );
      const nextChanges: Array<[string, unknown]> = [
        ['integrationId', integrationId],
        [
          'integrationName',
          selectedIntegration.name || selectedIntegration.host || '',
        ],
        ['integrationHost', selectedIntegration.host],
        ['backendType', selectedIntegration.backendType],
        ['pathTemplate', undefined],
        ['pathParams', undefined],
        ['body', undefined],
        ['pagination', undefined],
        ['effectivePaginationDefault', undefined],
        ['graphqlQuery', undefined],
        ['graphqlVariables', undefined],
        ['accountIds', undefined],
        ['accountSelection', undefined],
        ['resourceType', undefined],
        ['regions', undefined],
        ['resourceModel', undefined],
        ['roleName', undefined],
        ['externalId', undefined],
        ['authRegion', undefined],
        ['service', undefined],
        ['operation', undefined],
      ];

      if (selectedIntegration.backendType === 'aws') {
        nextChanges.push(
          ['path', undefined],
          ['method', undefined],
          ['headers', undefined],
          ['arrayExpression', undefined],
          ['objectIdExpression', 'id'],
          ['paginationMode', undefined],
          ['mode', 'cloud-control'],
        );
      } else {
        nextChanges.push(
          ['path', ''],
          ['method', 'GET'],
          ['headers', []],
          ['arrayExpression', '$'],
          ['objectIdExpression', 'id'],
          ['paginationMode', 'inherit'],
          ['mode', undefined],
        );
      }

      for (const [field, value] of nextChanges) {
        onChange(field, value);
      }
    },
    [onChange, queryClient],
  );

  const handleIntegrationUpdated = useCallback(
    (updated: Integration) => {
      queryClient.setQueryData(
        workspaceQueryKeyInScope(
          queryKeys.integrationDetail(String(updated.id)),
          workspaceScopeKey,
        ),
        updated,
      );
    },
    [queryClient, workspaceScopeKey],
  );

  const infoBanner = (
    <Alert variant="info" className="mb-4">
      <div className="flex items-start justify-between">
        <AlertDescription>
          <p className="text-sm">
            This source runs once per item returned from the previous step.
            {itemCount > 0 && ` (${itemCount} items)`}.
          </p>

          {availableFields.length > 0 && infoExpanded && (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground">
                Available fields for {'{{field}}'} templates:
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {availableFields.slice(0, 20).map(field => (
                  <span
                    key={field}
                    className="inline-flex items-center rounded-full border border-divider px-2 py-0.5 text-xs"
                  >
                    {field}
                  </span>
                ))}
                {availableFields.length > 20 && (
                  <span className="inline-flex items-center rounded-full border border-divider px-2 py-0.5 text-xs">
                    +{availableFields.length - 20} more
                  </span>
                )}
              </div>
            </div>
          )}
        </AlertDescription>
        {availableFields.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setInfoExpanded(prev => !prev)}
            className="size-6 shrink-0"
          >
            <ChevronDown
              className={cn(
                'motion-transform-standard size-4',
                infoExpanded && 'rotate-180',
              )}
            />
          </Button>
        )}
      </div>
    </Alert>
  );

  const resultMode =
    typeof config.resultMode === 'string' ? config.resultMode : 'enrich';

  return (
    <div>
      {infoBanner}
      <div className="mb-6 flex gap-3">
        <OptionCard
          icon={<LayoutGrid className="size-4" />}
          label="Enrich Items"
          selected={resultMode === 'enrich'}
          onClick={() => onChange('resultMode', 'enrich')}
          description={
            <>
              Keeps input items as primary output and attaches fetched data
              under <code className="text-xs">_additionalData</code>.
            </>
          }
        />
        <OptionCard
          icon={<List className="size-4" />}
          label="Flatten Items"
          selected={resultMode === 'flatten'}
          onClick={() => onChange('resultMode', 'flatten')}
          description={
            <>
              Replaces input items with fetched results. Each result becomes a
              top-level item with the original input as{' '}
              <code className="text-xs">_parent</code>.
            </>
          }
        />
      </div>
      <SourceConfig
        config={config}
        sourceType={resolvedSourceType}
        onChange={onChange}
        allowAccountTemplates
        onIntegrationSelect={handleIntegrationSelect}
        integration={integration}
        onIntegrationUpdated={handleIntegrationUpdated}
      />
    </div>
  );
}

interface OptionCardProps {
  icon: React.ReactNode;
  label: string;
  description: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}

function OptionCard({
  icon,
  label,
  description,
  selected,
  onClick,
}: OptionCardProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        'motion-colors h-auto min-w-0 flex-1 flex-col items-start rounded-lg border p-3 text-left whitespace-normal',
        selected
          ? 'border-primary bg-primary/5'
          : 'border-divider hover:border-primary/50',
      )}
    >
      <div className="mb-1 flex items-center gap-2">
        <span
          className={cn(selected ? 'text-primary' : 'text-muted-foreground')}
        >
          {icon}
        </span>
        <span className="text-sm font-medium">{label}</span>
        {selected && (
          <span className="ml-auto size-2 rounded-full bg-primary" />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </Button>
  );
}
