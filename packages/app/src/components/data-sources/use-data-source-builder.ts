import { useCallback } from 'react';
import {
  WorkflowNode,
  WorkflowEdge,
  NODE_TYPES,
} from '../../api/workflow/workflow-client';
import type { JsonValue } from '../../types';
import type { SourceType, TriggerType, PipelineStep, SinkStep } from './types';
import { buildPath } from './data-source-editor/sources/integration-path-suggestions';
import { parseRequestBodyText } from './request-body';
import type { SinkSchemaOverride } from './data-source-editor/data-source-editor-context';

// Normalizes a raw HTTP source config (as held in editor state) into the shape
// the backend expects: builds the headers map, resolves pathTemplate/pathParams
// into `path`, and parses the `bodyText` string into a `body` object (gated on
// method). Shared by the top-level HTTP source and chained HTTP sources so both
// send a request body on POST — see chained-source handling below.
function normalizeHttpSourceConfig(
  rawConfig: Record<string, unknown>,
): Record<string, unknown> {
  let headersObject: Record<string, string> = {};
  if (rawConfig.headers) {
    if (Array.isArray(rawConfig.headers)) {
      for (const h of rawConfig.headers) {
        if (h && typeof h === 'object' && 'key' in h && h.key) {
          headersObject[h.key] = h.value ?? '';
        }
      }
    } else if (typeof rawConfig.headers === 'object') {
      headersObject = rawConfig.headers as Record<string, string>;
    }
  }

  const httpConfig: Record<string, unknown> = {
    arrayExpression: '$',
    objectIdExpression: 'id',
    ...rawConfig,
    headers: headersObject,
  };

  if (httpConfig.mode === 'graphql') {
    let variables: Record<string, unknown> | undefined;
    const rawVariables =
      typeof httpConfig.graphqlVariables === 'string'
        ? (httpConfig.graphqlVariables as string).trim()
        : '';
    if (rawVariables) {
      try {
        const parsed = JSON.parse(rawVariables);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          variables = parsed as Record<string, unknown>;
        }
      } catch {
        variables = undefined;
      }
    }
    httpConfig.method = 'POST';
    httpConfig.graphql = {
      query: (httpConfig.graphqlQuery as string | undefined) ?? '',
      ...(variables && { variables }),
    };
  } else {
    if (
      typeof httpConfig.pathTemplate === 'string' &&
      httpConfig.pathParams &&
      typeof httpConfig.pathParams === 'object'
    ) {
      httpConfig.path = buildPath(
        httpConfig.pathTemplate,
        httpConfig.pathParams as Record<string, string>,
      );
    }
    const method = httpConfig.method === 'POST' ? 'POST' : 'GET';
    httpConfig.method = method;
    if (method === 'POST') {
      if (typeof httpConfig.bodyText === 'string') {
        const parsed = parseRequestBodyText(httpConfig.bodyText);
        // Invalid JSON is gated upstream; dropping it here is defense
        // in depth so garbage never reaches the saved config.
        if (parsed.ok && parsed.value !== undefined) {
          httpConfig.body = parsed.value;
        } else {
          delete httpConfig.body;
        }
      }
    } else {
      delete httpConfig.body;
    }
  }
  delete httpConfig.bodyText;

  return httpConfig;
}

interface UseDataSourceBuilderOptions {
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  sourceType: SourceType;
  sourceConfig: Record<string, unknown>;
  transforms: PipelineStep[];
  sinks: SinkStep[];
  confirmedSinkSchema: Record<string, JsonValue | null>;
}

export function useDataSourceBuilder({
  triggerType,
  triggerConfig,
  sourceType,
  sourceConfig,
  transforms,
  sinks,
  confirmedSinkSchema,
}: UseDataSourceBuilderOptions) {
  const buildWorkflowNodes = useCallback(
    (sinkSchemaOverride?: SinkSchemaOverride): WorkflowNode[] => {
      const nodes: WorkflowNode[] = [];
      let yPos = 0;

      if (triggerType === 'schedule') {
        nodes.push({
          id: 'trigger-node',
          type: NODE_TYPES.TRIGGER_SCHEDULE,
          position: { x: 250, y: yPos },
          data: {
            label: 'Schedule',
            config: {
              frequencyValue: 1,
              frequencyUnit: 'hours',
              ...triggerConfig,
            },
          },
        });
        yPos += 150;
      }

      if (sourceType === 'http') {
        const httpConfig = normalizeHttpSourceConfig(sourceConfig);

        nodes.push({
          id: 'source-node',
          type: NODE_TYPES.SOURCE_INTEGRATION,
          position: { x: 250, y: yPos },
          data: {
            label: httpConfig.mode === 'graphql' ? 'GraphQL' : 'HTTP/REST',
            config: httpConfig,
          },
        });
        yPos += 150;
      } else if (sourceType === 'aws') {
        let headersObject: Record<string, string> = {};
        if (sourceConfig.headers) {
          if (Array.isArray(sourceConfig.headers)) {
            for (const h of sourceConfig.headers) {
              if (h && typeof h === 'object' && 'key' in h && h.key) {
                headersObject[h.key] = h.value ?? '';
              }
            }
          } else if (typeof sourceConfig.headers === 'object') {
            headersObject = sourceConfig.headers as Record<string, string>;
          }
        }

        nodes.push({
          id: 'source-node',
          type: NODE_TYPES.SOURCE_INTEGRATION,
          position: { x: 250, y: yPos },
          data: {
            label: 'AWS',
            config: {
              ...sourceConfig,
              mode:
                sourceConfig.mode === 'service-api'
                  ? 'service-api'
                  : 'cloud-control',
              ...(sourceConfig.mode === 'service-api'
                ? { headers: headersObject }
                : {}),
            },
          },
        });
        yPos += 150;
      } else if (sourceType === 'datastore') {
        nodes.push({
          id: 'source-node',
          type: NODE_TYPES.SOURCE_DATASTORE,
          position: { x: 250, y: yPos },
          data: {
            label: 'Data Source',
            config: { ...sourceConfig },
          },
        });
        yPos += 150;
      }

      transforms.forEach(transform => {
        if (transform.type === 'chained-source') {
          // HTTP chained sources need the same normalization as the top-level
          // HTTP source — without it a POST chained source is saved with a raw
          // `bodyText` string that the backend ignores, so the request goes out
          // with no body and the upstream API rejects it (400). AWS chained
          // sources have no body/path templating and keep the passthrough shape.
          let chainedConfig: Record<string, unknown>;
          if (transform.config.backendType === 'aws') {
            let headersObject: Record<string, string> = {};
            if (transform.config.headers) {
              if (Array.isArray(transform.config.headers)) {
                for (const h of transform.config.headers as Array<{
                  key: string;
                  value: string;
                }>) {
                  if (h && typeof h === 'object' && 'key' in h && h.key) {
                    headersObject[h.key] = h.value ?? '';
                  }
                }
              } else if (typeof transform.config.headers === 'object') {
                headersObject = transform.config.headers as Record<
                  string,
                  string
                >;
              }
            }
            chainedConfig = {
              arrayExpression: '$',
              objectIdExpression: 'id',
              ...transform.config,
              headers: headersObject,
            };
          } else {
            chainedConfig = normalizeHttpSourceConfig(transform.config);
          }

          nodes.push({
            id: transform.id,
            type: NODE_TYPES.SOURCE_CHAINED,
            position: { x: 250, y: yPos },
            data: {
              label: 'Chained Source',
              config: chainedConfig,
            },
          });
          yPos += 150;
          return;
        }

        const transformLabels = {
          filter: 'Filter',
          map: 'Map',
          flatmap: 'Flatmap',
        } as const;

        nodes.push({
          id: transform.id,
          type: `transform-${transform.type}`,
          position: { x: 250, y: yPos },
          data: {
            label: transformLabels[transform.type],
            config: transform.config,
          },
        });
        yPos += 150;
      });

      sinks.forEach(sink => {
        const sinkConfig = { ...sink.config };
        const schema =
          sinkSchemaOverride?.[sink.id] ?? confirmedSinkSchema[sink.id];
        if (schema) {
          sinkConfig.schema = schema;
        }
        nodes.push({
          id: sink.id,
          type: `sink-${sink.type}`,
          position: { x: 250, y: yPos },
          data: {
            label: 'Store',
            config: sinkConfig,
          },
        });
        yPos += 150;
      });

      return nodes;
    },
    [
      triggerType,
      triggerConfig,
      sourceType,
      sourceConfig,
      transforms,
      sinks,
      confirmedSinkSchema,
    ],
  );

  const buildWorkflowEdges = useCallback(
    (sinkSchemaOverride?: SinkSchemaOverride): WorkflowEdge[] => {
      const nodes = buildWorkflowNodes(sinkSchemaOverride);
      const edges: WorkflowEdge[] = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        const current = nodes.at(i);
        const next = nodes.at(i + 1);
        if (!current || !next) {
          continue;
        }
        edges.push({
          id: `edge-${current.id}-${next.id}`,
          source: current.id,
          target: next.id,
        });
      }
      return edges;
    },
    [buildWorkflowNodes],
  );

  return { buildWorkflowNodes, buildWorkflowEdges };
}
