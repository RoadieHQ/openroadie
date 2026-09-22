import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { resolveItemSchema } from '@roadiehq/catalog-datastore-common';
import type { JsonValue } from '@roadiehq/types';
import type { WorkflowClient } from '../../api';
import type { SourceType } from './types';
import type { SourceConfig } from './data-source-editor/data-source-editor-context';
import { workspaceQueryKey } from '../../api/workspace-scope';

export function useSourceSchema(
  api: WorkflowClient,
  sourceType: SourceType,
  sourceConfig: SourceConfig,
  refreshKey?: number,
): JsonValue | null {
  const integrationId =
    typeof sourceConfig.integrationId === 'string'
      ? sourceConfig.integrationId
      : '';
  const method =
    typeof sourceConfig.method === 'string' ? sourceConfig.method : undefined;
  const pathCandidates = [sourceConfig.pathTemplate, sourceConfig.path].filter(
    (candidate, index, arr): candidate is string =>
      typeof candidate === 'string' &&
      candidate.length > 0 &&
      arr.indexOf(candidate) === index,
  );

  const enabled =
    sourceType === 'http' && !!integrationId && pathCandidates.length > 0;

  const { data: rawSourceSchema = null } = useQuery({
    queryKey: workspaceQueryKey(
      'integrationSchemas',
      'source',
      integrationId,
      pathCandidates,
      method ?? null,
      refreshKey ?? 0,
    ),
    queryFn: async () => {
      for (const candidatePath of pathCandidates) {
        const methodSchema = await api.integrationSchemas.getSchema(
          integrationId,
          candidatePath,
          method,
        );
        if (methodSchema?.jsonSchema) {
          return methodSchema.jsonSchema as JsonValue;
        }
        if (method) {
          const schema = await api.integrationSchemas.getSchema(
            integrationId,
            candidatePath,
          );
          if (schema?.jsonSchema) {
            return schema.jsonSchema as JsonValue;
          }
        }
      }
      return null;
    },
    enabled,
  });

  return useMemo(
    () =>
      resolveItemSchema(
        rawSourceSchema,
        sourceConfig.arrayExpression as string | undefined,
      ),
    [rawSourceSchema, sourceConfig.arrayExpression],
  );
}
