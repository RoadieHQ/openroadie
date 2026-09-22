/*
 * Copyright 2026 Larder Software Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { JsonValue } from '@roadiehq/types';
import type {
  ObjectPresentation,
  ObjectPresentationPurpose,
} from './object-presentation';
import type { Annotation, ProjectionValue } from './context-group-projection';

export type SortOrder = 'asc' | 'desc';

export interface DatastoreObject {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  datasourceId: string;
  objectId: string;
  object: JsonValue;
  presentation?: ObjectPresentation;
  relationshipCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface IndexConfiguration {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  datasourceId: string;
  key: string;
  valueExpression: string;
  purpose?: ObjectPresentationPurpose;
}

export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  sortOrder?: SortOrder;
  filter?: Record<string, string>;
  explain?: boolean;
}

export interface ExplainPlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Startup Cost'?: number;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  'Plan Width'?: number;
  'Actual Startup Time'?: number;
  'Actual Total Time'?: number;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  Plans?: ExplainPlanNode[];
  [key: string]: unknown;
}

export interface ExplainResult {
  Plan: ExplainPlanNode;
  'Planning Time'?: number;
  'Execution Time'?: number;
}

export interface QueryExplain {
  items: ExplainResult[];
  total: ExplainResult[];
}

export interface QueryResult {
  items: DatastoreObject[];
  total: number;
  explain?: QueryExplain;
}

export interface ObjectGraphNodeSummary {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  datasourceId: string;
  objectId: string;
  label: string;
  displayName: string;
  presentation?: ObjectPresentation;
  createdAt: string;
  updatedAt: string;
}

export interface ObjectGraphRelationshipSummary {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  sourceDatasourceId: string;
  sourceObjectId: string;
  destinationDatasourceId: string;
  destinationObjectId: string;
  relationshipType: string;
  ruleId?: string | null;
  origin: string;
  confidence?: number | null;
}

export interface ObjectGraphResult {
  nodes: ObjectGraphNodeSummary[];
  relationships: ObjectGraphRelationshipSummary[];
  totals: {
    objects: number;
    relationships: number;
  };
  truncated: boolean;
}

export interface ObjectGraphQueryOptions {
  datasourceIds?: string[];
  /** Skip the server-side row cap and load the full graph. Off by default. */
  unlimited?: boolean;
}

/** Hard cap applied per collection (nodes, relationships) when `unlimited` is off. */
export const OBJECT_GRAPH_DEFAULT_LIMIT = 5000;

export type GraphTraversalDirection = 'out' | 'in' | 'both';

/**
 * `rule` => rule_id IS NOT NULL; `direct` => rule_id IS NULL. The `origin`
 * column is free text (rule origins, 'integration-backed', 'preview',
 * 'manual') and does not discriminate rule vs directly-asserted edges.
 */
export type GraphEdgeOriginFilter = 'rule' | 'direct';

export interface GraphEdgeFilters {
  datasourceIds?: string[];
  /** An edge matches when its relation_type OR reciprocal_relation_type is listed. */
  relationshipTypes?: string[];
  origin?: GraphEdgeOriginFilter;
}

export interface RootedObjectGraphOptions extends GraphEdgeFilters {
  rootDatasourceId: string;
  rootObjectId: string;
  /** Hops from the root, 1..ROOTED_OBJECT_GRAPH_MAX_DEPTH. */
  depth?: number;
  direction?: GraphTraversalDirection;
  nodeLimit?: number;
}

export interface RootedObjectGraphNodeSummary extends ObjectGraphNodeSummary {
  /** Minimum hops from the root over any traversed path. */
  depth: number;
  /**
   * Distinct neighbors (under the same filters) that are not in the returned
   * graph — what a "+N" expand affordance can reveal. Dangling relationship
   * endpoints with no stored object are excluded: expanding would not
   * materialize them.
   */
  hiddenNeighborCount: number;
}

/**
 * `totals` count the returned subgraph (the true neighborhood size is
 * unknowable without an unbounded walk); `truncated` means a cap was hit.
 */
export interface RootedObjectGraphResult extends ObjectGraphResult {
  nodes: RootedObjectGraphNodeSummary[];
  /** `${datasourceId}:${objectId}` of the root. */
  rootNodeId: string;
}

export interface ObjectGraphPathsOptions extends GraphEdgeFilters {
  sourceDatasourceId: string;
  sourceObjectId: string;
  targetDatasourceId: string;
  targetObjectId: string;
  /** 1..OBJECT_GRAPH_PATHS_MAX_DEPTH hops. */
  maxDepth?: number;
  direction?: GraphTraversalDirection;
  pathLimit?: number;
}

export interface ObjectGraphPath {
  /** Ordered source..target. */
  nodes: Array<{ datasourceId: string; objectId: string }>;
  /** Edge row ids along the path; length === hops. */
  relationshipIds: string[];
  hops: number;
}

export interface ObjectGraphPathsResult extends ObjectGraphResult {
  /** Shortest first. `nodes`/`relationships` are the union across paths. */
  paths: ObjectGraphPath[];
}

export interface RelationshipSummaryItem {
  sourceDatasourceId: string;
  destinationDatasourceId: string;
  relationshipType: string;
  count: number;
}

export interface RelationshipSummaryResult {
  items: RelationshipSummaryItem[];
  totalRelationships: number;
}

export interface ListRelationshipTypesOptions {
  datasourceIds?: string[];
}

export const ROOTED_OBJECT_GRAPH_MAX_DEPTH = 3;
export const ROOTED_OBJECT_GRAPH_DEFAULT_DEPTH = 2;
/** Server-side hard cap; clients may request fewer nodes. */
export const ROOTED_OBJECT_GRAPH_SERVER_NODE_LIMIT = 500;
export const OBJECT_GRAPH_PATHS_DEFAULT_MAX_DEPTH = 3;
export const OBJECT_GRAPH_PATHS_MAX_DEPTH = 6;
export const OBJECT_GRAPH_PATHS_LIMIT = 50;

export interface CreateObjectInput {
  id: string;
  objectId: string;
  object: JsonValue;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateIndexConfigurationInput {
  key: string;
  valueExpression: string;
  purpose?: ObjectPresentationPurpose;
}

export interface PageOptions {
  limit?: number;
  offset?: number;
}

export interface RelationshipRuleListOptions extends PageOptions {
  state?: RelationshipRuleState;
  origin?: string;
}

export interface SearchOptions {
  q: string;
  datasourceIds?: string[];
  limit?: number;
  offset?: number;
  explain?: boolean;
}

export interface SearchResultItem {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  datasourceId: string;
  objectId: string;
  object: JsonValue;
  presentation?: ObjectPresentation;
}

export interface SearchResult {
  items: SearchResultItem[];
  total: number;
  explain?: {
    items: ExplainResult[];
  };
}

export interface DatastoreSchema {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  datasourceId: string;
  version: number;
  description: string;
  schema: JsonValue;
  contentHash: string;
  createdAt: string;
  integrationId?: string;
}

export interface Relationship {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  sourceDatasourceId: string;
  sourceObjectId: string;
  destinationDatasourceId: string;
  destinationObjectId: string;
  relationshipType: string;
  reciprocalRelationshipType?: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  ruleId?: string | null;
  sourceDatastoreId?: string | null;
  targetDatastoreId?: string | null;
  origin: string;
  confidence?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface RelationshipInput {
  sourceDatasourceId: string;
  sourceObjectId: string;
  destinationDatasourceId: string;
  destinationObjectId: string;
  relationshipType: string;
  reciprocalRelationshipType?: string;
  ruleId?: string;
  sourceDatastoreId?: string;
  targetDatastoreId?: string;
  origin?: string;
  confidence?: number;
  metadata?: Record<string, unknown> | null;
}

export type RelationshipRuleMatchStrategy =
  | 'exact'
  | 'contains'
  | 'array_contains'
  | 'regex'
  | 'person_name_alias';
export type RelationshipRuleStrategy = 'field-matching' | 'integration-backed';
export const RELATIONSHIP_RULE_STRATEGIES: readonly RelationshipRuleStrategy[] =
  ['field-matching', 'integration-backed'];

export function isRelationshipRuleStrategy(
  value: unknown,
): value is RelationshipRuleStrategy {
  return (
    typeof value === 'string' &&
    (RELATIONSHIP_RULE_STRATEGIES as readonly string[]).includes(value)
  );
}

export type RelationshipRuleOrigin = string;
export type RelationshipRuleState = 'suggested' | 'active' | 'inactive';
export type RelationshipSuggestionKind = 'identity' | 'relationship';
export type RelationshipConfidenceBand = 'high' | 'medium' | 'low';
export type RelationshipSuggestionValueType =
  | 'uuid'
  | 'email'
  | 'handle'
  | 'slug'
  | 'person_name'
  | 'enum_like'
  | 'numeric_id'
  | 'other';

export interface RelationshipSuggestionFieldStats {
  distinctCount: number;
  rowCoverage: number;
  cardinalityRatio: number;
  looksEnumLike: boolean;
  isIdentifierLike: boolean;
}

// Each field is present only when the gate that ran actually measured it —
// e.g. a `referenced-not-key-like` failure measures referencedCardinalityRatio
// but never touches containment. Absent means "not measured", not zero/false.
export interface RelationshipSuggestionGateEvidence {
  containment?: number;
  containmentDirection?: 'source-to-target' | 'target-to-source';
  containmentVerified?: boolean;
  referencedCardinalityRatio?: number;
  rescueHint?: string;
}

// Prior first, then table order; mirrors signalScoring.ts's WaterfallEntry.
export interface RelationshipSuggestionWaterfallEntry {
  signal: string;
  fired: boolean;
  weight: number;
  detail?: string;
}

export interface RelationshipSuggestionEvidenceSummary {
  valueTypes: RelationshipSuggestionValueType[];
  distinctMatchedValueCount: number;
  sourceFieldStats: RelationshipSuggestionFieldStats;
  targetFieldStats: RelationshipSuggestionFieldStats;
  sourceFieldSemantic?: RelationshipSuggestionFieldSemantic;
  targetFieldSemantic?: RelationshipSuggestionFieldSemantic;
  semanticCompatibility?: RelationshipSuggestionSemanticCompatibility;
  commonValuePenalty: number;
  topMatchedValues: string[];
  explanation: string;
  gate?: RelationshipSuggestionGateEvidence;
  /** Absent for gate-suppressed candidates — they are never FS-scored. */
  waterfall?: RelationshipSuggestionWaterfallEntry[];
  /** Present when this suggestion was recovered by the stage 4 rescue loop
   * after its plain field-match failed a gate. */
  rescue?: {
    kind: 'transform' | 'filter';
    detail: string;
    originalField?: string;
  };
}

export interface IntegrationBackedConfig {
  integrationId: string;
  method?: string;
  path: string;
  pathExpression?: string;
  sourceContext?: {
    maxDepth?: number;
    relationshipTypes?: string[];
    datasourceIds?: string[];
  };
  responseMatchExpression: string;
  metadataExpression?: string;
}

export interface RelationshipRule {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  name: string;
  description: string | null;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceFieldExpression: string;
  targetFieldExpression: string;
  sourceFilterExpression: string | null;
  targetFilterExpression: string | null;
  relationshipType: string;
  reciprocalRelationshipType: string | null;
  strategy: RelationshipRuleStrategy;
  matchStrategy: RelationshipRuleMatchStrategy;
  integrationConfig?: IntegrationBackedConfig | null;
  origin: RelationshipRuleOrigin;
  state: RelationshipRuleState;
  suggestionKind?: RelationshipSuggestionKind | null;
  score?: number | null;
  confidenceBand?: RelationshipConfidenceBand | null;
  evidenceSummary?: RelationshipSuggestionEvidenceSummary | null;
  reviewReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * On an update, `undefined` leaves a field alone and `null` clears it — the DAO
 * guards each field on `!== undefined` and coerces `?? null`. Only the fields
 * whose column is nullable accept `null`; the rest would break the rule.
 */
export interface RelationshipRuleInput {
  name: string;
  description?: string | null;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceFieldExpression: string;
  targetFieldExpression: string;
  /** `null` explicitly clears a stored filter (e.g. a refresh whose winning
   * suggestion carries no filter); `undefined` leaves it untouched on update. */
  sourceFilterExpression?: string | null;
  targetFilterExpression?: string | null;
  relationshipType: string;
  reciprocalRelationshipType?: string | null;
  strategy?: RelationshipRuleStrategy;
  matchStrategy?: RelationshipRuleMatchStrategy;
  integrationConfig?: IntegrationBackedConfig | null;
  origin?: RelationshipRuleOrigin;
  state?: RelationshipRuleState;
  suggestionKind?: RelationshipSuggestionKind;
  score?: number;
  confidenceBand?: RelationshipConfidenceBand;
  evidenceSummary?: RelationshipSuggestionEvidenceSummary;
  reviewReason?: string;
}

/**
 * Every id in the de-duplicated request appears in exactly one of `approved`,
 * `dismissedAsInverse` and `failed`, so a caller can always account for what it
 * asked about. `dismissedAsInverse` may also carry ids that were NOT requested
 * (a mirror suppressed on the winner's behalf) — that is the feature.
 */
export interface BulkApproveResult {
  approved: string[];
  /** Mirrored suggestions dismissed because their opposite direction won. */
  dismissedAsInverse: string[];
  /** Requested ids only, so a caller can count failures against its request. */
  failed: Array<{ id: string; reason: string }>;
  /**
   * Mirrors the caller never requested that could not be suppressed. They stay
   * `suggested` and need a manual dismiss — but they are not failures of the
   * caller's request, so they are reported apart from `failed`. Absent means
   * none.
   */
  inverseDismissFailed?: Array<{ id: string; reason: string }>;
}

export interface RelationshipQueryOptions {
  relationshipType?: string;
  limit?: number;
  offset?: number;
  origin?: string;
  ruleId?: string;
  /** Only edges not materialized by a rule (rule_id is null). */
  direct?: boolean;
}

export interface RelationshipQueryResult {
  items: Relationship[];
  total: number;
}

export interface ObjectRelationship extends Relationship {
  direction: 'outgoing' | 'incoming';
}

export interface JoinQueryOptions {
  leftDatasourceId: string;
  rightDatasourceId: string;
  leftIndexKey: string;
  rightIndexKey: string;
  rightAlias: string;
  limit?: number;
  offset?: number;
}

export interface JoinResultItem {
  id: string;
  datasourceId: string;
  objectId: string;
  object: JsonValue;
  [rightAlias: string]: JsonValue | DatastoreObject[] | string;
}

export interface JoinQueryResult {
  items: JoinResultItem[];
  total: number;
}

export interface DatastoreObjectWithRelationships extends DatastoreObject {
  relationships: ObjectRelationship[];
}

export interface RelationshipRulePreviewItem {
  sourceObjectId: string;
  relationshipType: string;
  targetObjectIds: string[];
  sourceValue?: string;
  targetValue?: string;
  matchSourceValues?: string[];
  matchTargetValues?: string[];
  sourceLabel?: string;
  targetLabels?: string[];
}

export interface RelationshipRulePreviewInput {
  name?: string;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceFieldExpression: string;
  targetFieldExpression?: string;
  relationshipType: string;
  reciprocalRelationshipType?: string;
  strategy?: RelationshipRuleStrategy;
  matchStrategy?: RelationshipRuleMatchStrategy;
  integrationConfig?: IntegrationBackedConfig | null;
  sourceFilterExpression?: string;
  targetFilterExpression?: string;
}

export interface RelationshipRulePreviewOptions {
  offset?: number;
  limit?: number;
  sampleLimit?: number;
  sourceObjectId?: string;
}

export interface RelationshipRulePreviewResult {
  items: RelationshipRulePreviewItem[];
  total: number;
  truncated?: boolean;
  callLimitReached?: boolean;
  skippedSources?: string[];
  responseSample?: {
    sourceObjectId: string;
    sourceValue: string;
    path: string;
    data: unknown;
  };
}

export interface FieldMatchSuggestion {
  sourceDatasourceId?: string;
  sourceField: string;
  targetDatasourceId: string;
  targetField: string;
  matchCount: number;
  sampleValues: string[];
  suggestionKind: RelationshipSuggestionKind;
  score: number;
  confidenceBand: RelationshipConfidenceBand;
  evidenceSummary: RelationshipSuggestionEvidenceSummary;
  suppressionReason?: string;
  matchStrategy?: RelationshipRuleMatchStrategy;
  /** Rendered JSONata for a transform-rescued candidate; mirrors `sourceField`. */
  sourceExpression?: string;
  /** JSONata boolean filter over the source object for a filter-rescued candidate. */
  sourceFilterExpression?: string;
}

export interface SuggestRelationshipsForDatasourceResult {
  total: number;
  suggestions: FieldMatchSuggestion[];
  createdRules: RelationshipRule[];
}

/**
 * A batch run's suggestions grouped by unordered datasource pair.
 * `datasourceIds` is sorted; each suggestion keeps its own direction via
 * `sourceDatasourceId`/`targetDatasourceId`.
 */
export interface RelationshipSuggestionPairGroup {
  datasourceIds: [string, string];
  suggestions: FieldMatchSuggestion[];
}

export interface SuggestRelationshipsResult {
  results: {
    datasourceId: string;
    total: number;
    suggestions: FieldMatchSuggestion[];
  }[];
  /** Present on servers that group by pair; absent on older backends. */
  pairs?: RelationshipSuggestionPairGroup[];
  createdRules: RelationshipRule[];
}

export type RelationshipSuggestionFieldSemantic =
  | 'person'
  | 'email'
  | 'tenant'
  | 'namespace'
  | 'service'
  | 'project'
  | 'team'
  | 'database'
  | 'resource_id'
  | 'environment'
  | 'classification'
  | 'unknown';

export type RelationshipSuggestionSemanticCompatibility =
  | 'same-domain'
  | 'related-domain'
  | 'weak-domain'
  | 'mismatch';

export interface DatasourceFilter {
  datasourceId?: string;
  seedName?: string;
  filter?: string;
  status?: ContextGroupDatasourceStatus;
  /** Read-time projection applied to each object of this datasource in the
   *  bundle (include or exclude mode). Empty/absent means the full object is
   *  returned. */
  projection?: ProjectionValue;
  /** Titled free-text instruction for this datasource within the rule. */
  annotation?: Annotation;
}

export interface ContextGroupDatasourceStatus {
  live: boolean;
  datasourceId?: string;
  seedName?: string;
  displayName?: string;
  inactiveReason?: string;
}

export interface ContextGroupRule {
  id: string;
  workspaceId?: string;
  ownership?: 'org' | 'workspace';
  name: string;
  slug: string;
  description: string | null;
  datasources: DatasourceFilter[];
  /** Objects related by any of these types are merged into one group. */
  mergeRelationshipTypes: string[];
  /** Rule-level titled free-text instructions for AI agents. */
  annotations: Annotation[];
  /** Whether the bundle emits external-relation identifiers (identifiers only). */
  includeExternalRelations: boolean;
  seedVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContextGroupRuleInput {
  name: string;
  slug?: string;
  description?: string;
  datasources: DatasourceFilter[];
  mergeRelationshipTypes?: string[];
  annotations?: Annotation[];
  includeExternalRelations?: boolean;
  seedVersion?: number;
}
