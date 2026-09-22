import type React from 'react';
import type {
  DatastoreSchema,
  RelationshipRule,
} from '../../../api/datastore/datastore-client';
import type { DataSourceItem } from '../types';
import type { EditorMode } from './editor-mode';
import type { SchemaField } from './schema-field-utils';
import type { SaveStatus } from './use-graph-layout-storage';

export const NODE_PREFIX = 'workflow-';

export interface RuleEdgeData {
  edgeId: string;
  ruleId?: string;
  sourceText: string;
  targetText: string;
  edgeColor: string;
  /** Redundant, CVD-safe channel paired with `edgeColor` (see
   * relationship-edge-style). Undefined = solid. */
  edgeDashPattern?: string;
  isSelected: boolean;
  isSuggested: boolean;
  isPending?: boolean;
  dimmed?: boolean;
  hasSelection?: boolean;
  onApprove?: (ruleId: string) => void;
  onDismiss?: (ruleId: string) => void;
  onDelete?: (ruleId: string) => void;
  [key: string]: unknown;
}

export interface EnrichedItem {
  ds: DataSourceItem;
  schema: DatastoreSchema | undefined;
  schemaFields: SchemaField[];
}

export interface PendingRelationshipConnection {
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceLabel: string;
  targetLabel: string;
  sourceFields: SchemaField[];
  targetFields: SchemaField[];
  initialSourceField?: string;
  initialTargetField?: string;
  sourceHandleId?: string | null;
  targetHandleId?: string | null;
}

export interface DataSourcesGraphViewProps {
  dataSources: DataSourceItem[];
  schemas: DatastoreSchema[];
  rules: RelationshipRule[];
  onSetDataSourceEnabled?: (id: string, enabled: boolean) => Promise<void>;
  /** Hide a data source from the editor view by scoping it out of the current
   * data-source filter (non-destructive; reversible via the header filter). */
  onHideDataSource?: (id: string) => void;
  /** Permanently delete a data source (its workflow); the graph view handles
   * the confirm dialog and removes the node + its rules. */
  onDeleteDataSource?: (id: string) => Promise<void>;
  onSaveStatusChange?: (status: SaveStatus) => void;
  onModeChange?: (mode: EditorMode) => void;
  // URL-driven scope. When `scopedDataSourceIds` is non-null, only those data
  // sources are shown (everything else hidden). The relationship filters keep
  // edges whose type is in `relationshipTypeFilter` OR whose rule id is in
  // `relationshipRuleFilter`. `focusedRelationshipRuleId` centers the viewport
  // on that relationship without changing the editor mode.
  scopedDataSourceIds?: string[] | null;
  relationshipTypeFilter?: string[] | null;
  relationshipRuleFilter?: string[] | null;
  focusedRelationshipRuleId?: string | null;
}

export const LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  background: 'var(--color-card)',
  padding: '1px 5px',
  borderRadius: 3,
  whiteSpace: 'nowrap',
  pointerEvents: 'none',
};
