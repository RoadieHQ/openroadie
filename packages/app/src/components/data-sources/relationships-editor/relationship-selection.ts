import type { Edge } from '@xyflow/react';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import type { SchemaField } from './schema-field-utils';
import type { PendingRelationshipConnection } from './types';

export function createPendingConnectionFromRule({
  rule,
  edge,
  labelById,
  fieldsById,
}: {
  rule: RelationshipRule;
  // Optional: a rule opened from a shareable URL has no originating edge, so
  // the connection just has no specific handles.
  edge?: Pick<Edge, 'sourceHandle' | 'targetHandle'>;
  labelById: ReadonlyMap<string, string>;
  fieldsById: ReadonlyMap<string, SchemaField[]>;
}): PendingRelationshipConnection {
  return {
    sourceDatasourceId: rule.sourceDatasourceId,
    targetDatasourceId: rule.targetDatasourceId,
    sourceLabel:
      labelById.get(rule.sourceDatasourceId) ?? rule.sourceDatasourceId,
    targetLabel:
      labelById.get(rule.targetDatasourceId) ?? rule.targetDatasourceId,
    sourceFields: fieldsById.get(rule.sourceDatasourceId) ?? [],
    targetFields: fieldsById.get(rule.targetDatasourceId) ?? [],
    sourceHandleId: edge?.sourceHandle ?? null,
    targetHandleId: edge?.targetHandle ?? null,
  };
}
