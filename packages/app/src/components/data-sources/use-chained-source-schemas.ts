import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  resolveItemSchema,
  resolveCompositeSchema,
} from '@roadiehq/catalog-datastore-common';
import { deriveAwsDataKey, type JsonValue } from '@roadiehq/types';
import type { WorkflowClient } from '../../api';
import type { PipelineStep } from './types';
import { workspaceQueryKey } from '../../api/workspace-scope';

// Stable fallback: a fresh `{}` per render would change the identity of the
// hook's result while the query is unresolved, which cascades through the
// `finalSchema` memo + `setAccumulatedSchema` effect in TransformSteps into an
// infinite render loop ("Maximum update depth exceeded") once node outputs
// exist.
const EMPTY_SCHEMAS: Record<string, JsonValue | null> = {};

export function useChainedSourceSchemas(
  api: WorkflowClient,
  transforms: PipelineStep[],
): Record<string, JsonValue | null> {
  const chainedSources = useMemo(
    () => transforms.filter(t => t.type === 'chained-source'),
    [transforms],
  );

  const chainedSourceKey = useMemo(
    () =>
      chainedSources
        .map(t => {
          const c = t.config;
          return `${t.id}:${c.backendType ?? ''}:${c.integrationId ?? ''}:${
            c.pathTemplate ?? ''
          }:${c.path ?? ''}:${c.method ?? ''}:${c.arrayExpression ?? ''}`;
        })
        .join('|'),
    [chainedSources],
  );

  const { data: schemas } = useQuery({
    queryKey: workspaceQueryKey(
      'integrationSchemas',
      'chained',
      chainedSourceKey,
    ),
    queryFn: async () => {
      const result: Record<string, JsonValue | null> = {};

      await Promise.all(
        chainedSources.map(async cs => {
          const config = cs.config;
          if (config.backendType === 'aws' || !config.integrationId) {
            return;
          }

          const integrationId = config.integrationId as string;
          const pathCandidates = [config.pathTemplate, config.path].filter(
            (c, i, arr): c is string =>
              typeof c === 'string' && c.length > 0 && arr.indexOf(c) === i,
          );
          const method =
            typeof config.method === 'string' ? config.method : undefined;

          if (pathCandidates.length === 0) {
            return;
          }

          let matchedSchema: JsonValue | null = null;
          for (const candidatePath of pathCandidates) {
            try {
              const methodSchema = await api.integrationSchemas.getSchema(
                integrationId,
                candidatePath,
                method,
              );
              if (methodSchema?.jsonSchema) {
                matchedSchema = methodSchema.jsonSchema as JsonValue;
                break;
              }

              if (method) {
                const schema = await api.integrationSchemas.getSchema(
                  integrationId,
                  candidatePath,
                );
                if (schema?.jsonSchema) {
                  matchedSchema = schema.jsonSchema as JsonValue;
                  break;
                }
              }
            } catch {
              // ignore fetch errors for individual schemas
            }
          }

          const arrayExpression =
            typeof config.arrayExpression === 'string'
              ? config.arrayExpression
              : undefined;
          result[cs.id] = resolveItemSchema(matchedSchema, arrayExpression);
        }),
      );

      return result;
    },
    enabled: !!chainedSourceKey,
  });

  return schemas ?? EMPTY_SCHEMAS;
}

function deriveHttpDataKey(config: Record<string, unknown>): string {
  if (typeof config.path !== 'string') {
    return 'data';
  }
  const parts = config.path.split('/').filter(Boolean);
  const last = parts[parts.length - 1] ?? 'data';
  return last.replace(/[^a-zA-Z0-9]/g, '') || 'data';
}

export function deriveDataKeyFrontend(config: Record<string, unknown>): string {
  if (config.backendType === 'aws') {
    return deriveAwsDataKey(config);
  }
  return deriveHttpDataKey(config);
}

type SchemaObject = Record<string, JsonValue>;

function isSchemaObject(v: JsonValue | null | undefined): v is SchemaObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getSchemaProperties(schema: SchemaObject): Record<string, JsonValue> {
  const properties = schema.properties;
  return isSchemaObject(properties) ? properties : {};
}

function resolveToObject(
  schema: JsonValue | null | undefined,
): SchemaObject | null {
  if (!isSchemaObject(schema)) {
    return null;
  }
  const resolved = resolveCompositeSchema(schema as Record<string, JsonValue>);
  return isSchemaObject(resolved as JsonValue)
    ? (resolved as SchemaObject)
    : null;
}

export function buildChainedOutputSchema(
  upstreamSchema: JsonValue | null,
  chainedItemSchema: JsonValue | null,
  resultMode: string,
  dataKey: string,
): JsonValue | null {
  const resolvedChained = resolveToObject(chainedItemSchema);
  if (!resolvedChained) {
    return null;
  }

  if (resultMode === 'flatten') {
    const resolvedUpstream = resolveToObject(upstreamSchema);
    const parentSchema = resolvedUpstream ?? { type: 'object' };

    return {
      type: 'object',
      properties: {
        ...getSchemaProperties(resolvedChained),
        _parent: parentSchema,
      },
    };
  }

  const resolvedUpstream = resolveToObject(upstreamSchema);
  const baseProps = resolvedUpstream
    ? getSchemaProperties(resolvedUpstream)
    : {};

  const existingAd =
    baseProps._additionalData && isSchemaObject(baseProps._additionalData)
      ? resolveToObject(baseProps._additionalData)
      : undefined;

  const existingAdProps =
    existingAd && isSchemaObject(existingAd.properties)
      ? existingAd.properties
      : {};

  return {
    type: 'object',
    properties: {
      ...baseProps,
      _additionalData: {
        type: 'object',
        properties: {
          ...existingAdProps,
          [dataKey]: {
            type: 'array',
            items: resolvedChained as JsonValue,
          },
        },
      },
    },
  };
}
