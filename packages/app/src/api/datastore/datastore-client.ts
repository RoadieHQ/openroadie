import {
  OBJECT_GRAPH_PATHS_DEFAULT_MAX_DEPTH,
  OBJECT_GRAPH_PATHS_LIMIT,
  OBJECT_GRAPH_PATHS_MAX_DEPTH,
  ROOTED_OBJECT_GRAPH_DEFAULT_DEPTH,
  ROOTED_OBJECT_GRAPH_MAX_DEPTH,
  ROOTED_OBJECT_GRAPH_SERVER_NODE_LIMIT,
  type Annotation,
  type BulkApproveResult,
  type FieldMapping,
  type GraphEdgeFilters,
  type GraphEdgeOriginFilter,
  type GraphTraversalDirection,
  type ListRelationshipTypesOptions,
  type ObjectGraphPath,
  type ObjectGraphPathsOptions,
  type ObjectGraphPathsResult,
  type Projection,
  type ProjectionValue,
  type IntegrationBackedConfig,
  type ObjectGraphNodeSummary,
  type ObjectGraphRelationshipSummary,
  type ObjectGraphResult,
  type RelationshipRuleStrategy,
  type RootedObjectGraphNodeSummary,
  type RootedObjectGraphOptions,
  type RootedObjectGraphResult,
} from '@roadiehq/catalog-datastore-common';
import { ResponseError } from '../infrastructure';
import type { WorkspaceOwnershipFields } from '../workspace-scope';

export {
  OBJECT_GRAPH_PATHS_DEFAULT_MAX_DEPTH,
  OBJECT_GRAPH_PATHS_LIMIT,
  OBJECT_GRAPH_PATHS_MAX_DEPTH,
  ROOTED_OBJECT_GRAPH_DEFAULT_DEPTH,
  ROOTED_OBJECT_GRAPH_MAX_DEPTH,
  ROOTED_OBJECT_GRAPH_SERVER_NODE_LIMIT,
  type GraphEdgeFilters,
  type GraphEdgeOriginFilter,
  type GraphTraversalDirection,
  type IntegrationBackedConfig,
  type ListRelationshipTypesOptions,
  type ObjectGraphNodeSummary,
  type ObjectGraphPath,
  type ObjectGraphPathsOptions,
  type ObjectGraphPathsResult,
  type ObjectGraphRelationshipSummary,
  type ObjectGraphResult,
  type RelationshipRuleStrategy,
  type RootedObjectGraphNodeSummary,
  type RootedObjectGraphOptions,
  type RootedObjectGraphResult,
};

// ---------------------------------------------------------------------------
// Inline types (mirrored from catalog-datastore-common)
// ---------------------------------------------------------------------------

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type SortOrder = 'asc' | 'desc';

export interface DatastoreObject extends WorkspaceOwnershipFields {
  id: string;
  datasourceId: string;
  objectId: string;
  object: JsonValue;
  presentation?: ObjectPresentation;
  relationshipCount?: number;
  contextGroups?: ContextGroupReference[];
  createdAt: string;
  updatedAt: string;
}

export type ObjectPresentationPurpose =
  | 'column'
  | 'title'
  | 'subtitle'
  | 'image';

export interface ObjectPresentation {
  title: string;
  subtitle?: string;
  image?: string;
}

export interface IndexConfiguration extends WorkspaceOwnershipFields {
  id: string;
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

/** Objects currently stored in the datastore for one data source. */
export interface DatasourceObjectCount {
  datasourceId: string;
  count: number;
}

export interface SearchObjectsOptions {
  q: string;
  /** Restrict the full-text search to these data sources. */
  datasourceIds?: string[];
  limit?: number;
  offset?: number;
}

/** Full-text search hit; note it carries no createdAt/updatedAt timestamps. */
export interface SearchResultItem extends WorkspaceOwnershipFields {
  id: string;
  datasourceId: string;
  objectId: string;
  object: JsonValue;
  presentation?: ObjectPresentation;
  contextGroups?: ContextGroupReference[];
}

export interface SearchResult {
  items: SearchResultItem[];
  total: number;
}

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

export interface QueryAllOptions extends PageOptions {
  orderBy?: string;
  sortOrder?: SortOrder;
  /** Restrict the cross-source listing to these data sources. */
  datasourceIds?: string[];
}

export interface RelationshipRuleListOptions extends PageOptions {
  state?: RelationshipRuleState;
  origin?: string;
  reviewReason?: string;
}

/** The suggestion's 0-based position in the ordered list the reviewer saw
 *  when they acted on it — recorded for later ranking-quality analysis. */
export interface RelationshipRuleTransitionOptions {
  rankShown?: number;
}

export interface DatastoreSchema extends WorkspaceOwnershipFields {
  id: string;
  datasourceId: string;
  version: number;
  description: string;
  schema: JsonValue;
  contentHash: string;
  createdAt: string;
}

export interface Relationship extends WorkspaceOwnershipFields {
  id: string;
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

export interface CreateRelationshipInput extends RelationshipInput {
  origin: string;
}

export type RelationshipRuleMatchStrategy =
  | 'exact'
  | 'contains'
  | 'array_contains'
  | 'regex'
  | 'person_name_alias';
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

export interface RelationshipRule extends WorkspaceOwnershipFields {
  id: string;
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

export interface RelationshipRuleInput {
  name: string;
  description?: string;
  sourceDatasourceId: string;
  targetDatasourceId: string;
  sourceFieldExpression: string;
  targetFieldExpression: string;
  /** `null` explicitly clears a stored filter; `undefined` leaves it untouched
   * on update. Mirrors `RelationshipRuleInput` in `catalog-datastore-common`. */
  sourceFilterExpression?: string | null;
  targetFilterExpression?: string;
  relationshipType: string;
  reciprocalRelationshipType?: string;
  strategy?: RelationshipRuleStrategy;
  matchStrategy?: RelationshipRuleMatchStrategy;
  integrationConfig?: IntegrationBackedConfig | null;
  origin?: RelationshipRuleOrigin;
  suggestionKind?: RelationshipSuggestionKind;
  score?: number;
  confidenceBand?: RelationshipConfidenceBand;
  evidenceSummary?: RelationshipSuggestionEvidenceSummary;
  reviewReason?: string;
}

export interface RelationshipQueryOptions {
  relationshipType?: string;
  limit?: number;
  offset?: number;
  origin?: string;
  ruleId?: string;
  /** Only edges not materialized by a rule (ruleId is null). */
  direct?: boolean;
}

/**
 * A direct relationship is one asserted by hand rather than materialized by a
 * relationship rule. `ruleId` is the only reliable test — rule edges copy
 * their rule's `origin`, so a manually-authored rule also yields
 * `origin: 'manual'` edges.
 */
export function isDirectRelationship(
  relationship: Pick<Relationship, 'ruleId'>,
): boolean {
  return relationship.ruleId == null;
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

export interface ExampleRelationshipPatternCandidate {
  sourceFieldExpression: string;
  targetFieldExpression: string;
  matchedValue: string;
  score: number;
}

export interface InferExampleRelationshipPatternInput {
  sourceDatasourceId: string;
  sourceObjectId: string;
  targetDatasourceId: string;
  targetObjectId: string;
}

export interface InferExampleRelationshipPatternResult {
  candidates: ExampleRelationshipPatternCandidate[];
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
  /** Gate-suppressed candidates, capped server-side (SUPPRESSED_RESPONSE_CAP). */
  suppressedSuggestions?: FieldMatchSuggestion[];
  createdRules: RelationshipRule[];
}

export interface SuggestRelationshipsResult {
  results: {
    datasourceId: string;
    total: number;
    suggestions: FieldMatchSuggestion[];
    /** Gate-suppressed candidates, capped server-side (SUPPRESSED_RESPONSE_CAP). */
    suppressedSuggestions?: FieldMatchSuggestion[];
  }[];
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
  /** Serialized `FilterCondition[]`; objects must match every condition to
   *  enter a group. */
  filter?: string;
  status?: ContextGroupDatasourceStatus;
  /** Read-time projection applied to each object of this datasource in the
   *  bundle (include or exclude mode). Empty/absent means the full object is
   *  returned. */
  projection?: ProjectionValue;
  /** Titled free-text instruction for this datasource within the rule. */
  annotation?: Annotation;
}

export type { Annotation, FieldMapping, Projection, ProjectionValue };

export interface ContextGroupDatasourceStatus {
  live: boolean;
  datasourceId?: string;
  seedName?: string;
  displayName?: string;
  inactiveReason?: string;
}

export interface ContextGroupRule extends WorkspaceOwnershipFields {
  id: string;
  name: string;
  /** URL-safe unique identifier; used to @-reference the context group in capabilities. */
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
}

export interface ContextGroup extends WorkspaceOwnershipFields {
  id: string;
  ruleId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContextGroupMember extends WorkspaceOwnershipFields {
  id: string;
  contextGroupId: string;
  datasourceId: string;
  objectId: string;
  createdAt: string;
}

export interface ContextGroupPreviewMember {
  datasourceId: string;
  objectId: string;
  object: unknown;
  presentation?: ObjectPresentation;
}

export interface ContextGroupPreviewGroup {
  id: string;
  name: string;
  members: ContextGroupPreviewMember[];
}

export interface ContextGroupPreviewResult {
  groups: ContextGroupPreviewGroup[];
  totalGroups: number;
}

export interface ContextGroupPreviewInput {
  datasources: DatasourceFilter[];
  mergeRelationshipTypes?: string[];
}

/** A named, rule-level view of a context group: a Liquid template rendered
 *  over the whole group document at bundle-read time. Every rule has exactly
 *  one default view. */
export interface ContextGroupView extends WorkspaceOwnershipFields {
  id: string;
  ruleId: string;
  name: string;
  description: string | null;
  template: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContextGroupViewInput {
  name: string;
  description?: string;
  template: string;
  isDefault?: boolean;
}

export interface ContextGroupViewInfo {
  name: string;
  description: string | null;
  isDefault?: boolean;
}

export interface RenderedContextGroupBundle extends WorkspaceOwnershipFields {
  groupId: string;
  ruleId: string;
  ruleName: string;
  group?: { id: string; name: string };
  rule?: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
  };
  view: ContextGroupViewInfo;
  availableViews: ContextGroupViewInfo[];
  rendered: string;
}

export interface ProjectionFieldInfo {
  path: string;
  valueType: string;
  container: string;
  isIdentifierLike: boolean;
  looksEnumLike: boolean;
  rowCoverage: number;
  cardinalityRatio: number;
}

export interface ContextGroupFieldProfiles {
  datasourceId: string;
  fields: ProjectionFieldInfo[];
  presets: { identifiers: string[]; essentials: string[] };
}

/** One data source as a view template sees it: the document key its
 *  templates address (`members.<key>`), the fields its objects carry, and the
 *  relationship types its members can expand. */
export interface ContextGroupViewSource {
  key: string;
  datasourceId: string;
  label: string;
  fields: ProjectionFieldInfo[];
  presets: { identifiers: string[]; essentials: string[] };
  relationshipTypes: {
    type: string;
    count: number;
    /** Data sources the type points at. Exactly one means the builder can
     *  offer field selection on the expanded objects. */
    targetDatasourceIds: string[];
  }[];
}

export interface ContextGroupViewSchema {
  ruleId: string;
  /** The materialized group the schema was derived from — also the group the
   *  builder previews against. Null when the rule has no groups yet. */
  sampleGroupId: string | null;
  sources: ContextGroupViewSource[];
}

export interface ContextGroupBundleDatasource {
  datasourceId: string;
  annotation?: Annotation;
  objects: { objectId: string; data: unknown }[];
}

export interface ContextGroupBundleExternalRelation {
  fromDatasourceId: string;
  fromObjectId: string;
  toDatasourceId: string;
  toObjectId: string;
  relationshipType: string;
}

export interface ContextGroupBundle extends WorkspaceOwnershipFields {
  id: string;
  ruleId: string;
  ruleName: string;
  ruleDescription: string | null;
  title: string;
  totalMembers?: number;
  totalInternalRelationships?: number;
  totalExternalRelationships?: number;
  datasourceIds?: string[];
  members: ContextGroupBundleMember[];
  internalRelationships: ContextGroupBundleRelationship[];
  externalRelationships: ContextGroupBundleRelationship[];
  annotations: Annotation[];
  datasources: ContextGroupBundleDatasource[];
  externalRelations?: ContextGroupBundleExternalRelation[];
}

/** A context group an object belongs to, flattened with its rule identity. */
export interface ContextGroupMembership {
  groupId: string;
  ruleId: string;
  ruleName: string;
  ruleSlug: string;
  title: string;
}

export interface ContextGroupReference {
  groupId: string;
  ruleId: string;
  ruleName: string;
  title: string;
}

export interface ContextGroupBundleMember {
  datasourceId: string;
  objectId: string;
  object: unknown;
  presentation: ObjectPresentation;
}

export interface ContextGroupBundleRelationshipEndpoint {
  datasourceId: string;
  objectId: string;
  object?: unknown;
  presentation?: ObjectPresentation;
}

export interface ContextGroupBundleRelationship {
  id: string;
  source: ContextGroupBundleRelationshipEndpoint;
  destination: ContextGroupBundleRelationshipEndpoint;
  relationshipType: string;
  reciprocalRelationshipType?: string | null;
  direction?: 'outgoing' | 'incoming' | 'internal';
}

export interface CatalogDatastoreApi {
  queryObjects(
    datasourceId: string,
    options?: QueryOptions,
    signal?: AbortSignal,
  ): Promise<QueryResult>;
  searchObjects(
    options: SearchObjectsOptions,
    signal?: AbortSignal,
  ): Promise<SearchResult>;
  getObject(
    datasourceId: string,
    objectId: string,
  ): Promise<DatastoreObjectWithRelationships>;
  addObject(datasourceId: string, input: CreateObjectInput): Promise<void>;
  replaceObjects(
    datasourceId: string,
    items: CreateObjectInput[],
  ): Promise<void>;
  deleteObject(datasourceId: string, objectId: string): Promise<void>;
  deleteAllObjects(datasourceId: string): Promise<void>;

  listIndexConfigurations(
    datasourceId: string,
    signal?: AbortSignal,
  ): Promise<IndexConfiguration[]>;
  getIndexConfiguration(
    datasourceId: string,
    key: string,
  ): Promise<IndexConfiguration>;
  listIndexValues(
    datasourceId: string,
    key: string,
    options?: { q?: string; limit?: number },
  ): Promise<string[]>;
  createIndexConfiguration(
    datasourceId: string,
    input: CreateIndexConfigurationInput,
  ): Promise<void>;
  deleteIndexConfiguration(datasourceId: string, key: string): Promise<void>;
  deleteAllIndexConfigurations(datasourceId: string): Promise<void>;
  rebuildIndexConfiguration(datasourceId: string, key: string): Promise<void>;

  upsertRelationship(input: RelationshipInput): Promise<Relationship>;
  upsertRelationships(inputs: RelationshipInput[]): Promise<Relationship[]>;
  getRelationship(id: string): Promise<Relationship | undefined>;
  deleteRelationship(id: string): Promise<void>;
  queryRelationships(
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipQueryResult>;
  queryRelationshipsBySource(
    datasourceId: string,
    objectId: string,
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipQueryResult>;
  queryRelationshipsByDestination(
    datasourceId: string,
    objectId: string,
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipQueryResult>;
  deleteRelationshipsBySource(
    datasourceId: string,
    objectId: string,
  ): Promise<void>;
  deleteRelationshipsByDestination(
    datasourceId: string,
    objectId: string,
  ): Promise<void>;
  listRelationshipTypes(datasourceId: string): Promise<string[]>;

  queryAllObjects(
    options?: QueryAllOptions,
    signal?: AbortSignal,
  ): Promise<QueryResult>;
  getObjectCountsByDatasource(): Promise<DatasourceObjectCount[]>;
  queryRootedObjectGraph(
    options: RootedObjectGraphOptions,
    signal?: AbortSignal,
  ): Promise<RootedObjectGraphResult>;

  queryObjectGraphPaths(
    options: ObjectGraphPathsOptions,
    signal?: AbortSignal,
  ): Promise<ObjectGraphPathsResult>;

  /** Distinct types across a datasource scope; the per-datasource
   * listRelationshipTypes covers the source-side-only legacy route. */
  listAllRelationshipTypes(
    options?: ListRelationshipTypesOptions,
  ): Promise<string[]>;
  queryAllRelationships(
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipQueryResult>;

  queryWithJoin(options: JoinQueryOptions): Promise<JoinQueryResult>;

  getLatestSchema(datasourceId: string): Promise<DatastoreSchema | undefined>;
  listSchemaVersions(
    datasourceId: string,
    options?: PageOptions,
  ): Promise<{ items: DatastoreSchema[]; total: number }>;
  listDatasourceSchemas(
    options?: PageOptions,
  ): Promise<{ items: DatastoreSchema[]; total: number }>;

  listRelationshipRules(
    options?: RelationshipRuleListOptions,
  ): Promise<{ items: RelationshipRule[]; total: number }>;
  createRelationshipRule(
    input: RelationshipRuleInput,
  ): Promise<RelationshipRule>;
  updateRelationshipRule(
    id: string,
    input: Partial<RelationshipRuleInput>,
  ): Promise<RelationshipRule>;
  applyRelationshipRule(
    id: string,
  ): Promise<{ created: number; deleted: number }>;
  approveRelationshipRule(
    id: string,
    options?: RelationshipRuleTransitionOptions,
  ): Promise<RelationshipRule>;
  approveRelationshipRules(ids: string[]): Promise<BulkApproveResult>;
  dismissRelationshipRule(
    id: string,
    options?: RelationshipRuleTransitionOptions,
  ): Promise<RelationshipRule>;
  disableRelationshipRule(id: string): Promise<RelationshipRule>;
  resetRelationshipRule(
    id: string,
    options?: RelationshipRuleTransitionOptions,
  ): Promise<RelationshipRule>;
  deleteRelationshipRule(id: string): Promise<void>;
  previewRelationshipRule(
    input: RelationshipRulePreviewInput,
    options?: RelationshipRulePreviewOptions,
  ): Promise<RelationshipRulePreviewResult>;
  inferExampleRelationshipPattern(
    input: InferExampleRelationshipPatternInput,
  ): Promise<InferExampleRelationshipPatternResult>;

  suggestRelationships(
    datasourceId: string,
  ): Promise<SuggestRelationshipsForDatasourceResult>;

  suggestRelationshipsBatch(
    datasourceIds: string[],
  ): Promise<SuggestRelationshipsResult>;

  listContextGroupRules(
    options?: PageOptions,
  ): Promise<{ items: ContextGroupRule[]; total: number }>;
  getContextGroupRule(id: string): Promise<ContextGroupRule | undefined>;
  createContextGroupRule(
    input: ContextGroupRuleInput,
  ): Promise<ContextGroupRule>;
  updateContextGroupRule(
    id: string,
    input: Partial<ContextGroupRuleInput>,
  ): Promise<ContextGroupRule>;
  deleteContextGroupRule(id: string): Promise<void>;
  materializeContextGroupRule(id: string): Promise<void>;
  /** Rebuilds the groups of every rule referencing the datasource, resolving
   *  when the rebuild is done — the awaitable follow-up to a direct-edge
   *  write (the event-driven rebuild those writes trigger is debounced). */
  materializeContextGroupsForDatasource(datasourceId: string): Promise<void>;
  listContextGroups(
    options?: PageOptions & { ruleId?: string },
  ): Promise<{ items: ContextGroup[]; total: number }>;
  getContextGroup(id: string): Promise<ContextGroup | undefined>;
  getContextGroupBundle(
    id: string,
    options?: {
      memberLimit?: number;
      relationshipLimit?: number;
      datasourceIds?: string[];
    },
  ): Promise<ContextGroupBundle>;
  listContextGroupMembers(
    groupId: string,
    options?: PageOptions,
  ): Promise<{ items: ContextGroupMember[]; total: number }>;
  listContextGroupTitles(
    datasourceId: string,
    options?: { q?: string; limit?: number },
  ): Promise<string[]>;
  previewContextGroupRule(
    input: ContextGroupPreviewInput,
  ): Promise<ContextGroupPreviewResult>;
  getContextGroupFieldProfiles(
    datasourceId: string,
  ): Promise<ContextGroupFieldProfiles>;
  getContextGroupRuleGroups(
    ruleId: string,
    options?: PageOptions & { q?: string },
  ): Promise<ContextGroupPreviewResult>;
  findContextGroupsByMember(
    datasourceId: string,
    objectId: string,
  ): Promise<ContextGroupMembership[]>;
}

/** Shared body serialization for the approve/dismiss/reset transition
 *  endpoints: send `{ rankShown }` only when it's a non-negative integer, so
 *  callers that don't track it (or pass a stale/invalid value) keep sending
 *  the old no-body request rather than a request the backend would reject. */
function rankShownRequestInit(rankShown?: number): RequestInit {
  if (
    rankShown === undefined ||
    !Number.isInteger(rankShown) ||
    rankShown < 0
  ) {
    return {};
  }
  return {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rankShown }),
  };
}

/** Shared query-param serialization for the graph traversal endpoints. */
function setGraphFilterParams(
  params: URLSearchParams,
  options: GraphEdgeFilters & { direction?: GraphTraversalDirection },
): void {
  if (options.datasourceIds && options.datasourceIds.length > 0) {
    params.set('datasourceIds', options.datasourceIds.join(','));
  }
  if (options.relationshipTypes && options.relationshipTypes.length > 0) {
    params.set('relationshipTypes', options.relationshipTypes.join(','));
  }
  if (options.origin) {
    params.set('origin', options.origin);
  }
  if (options.direction) {
    params.set('direction', options.direction);
  }
}

export class CatalogDatastoreClient implements CatalogDatastoreApi {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(baseUrl: string, fetch: typeof globalThis.fetch) {
    this.baseUrl = baseUrl;
    this.fetch = fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    return JSON.parse(text);
  }

  async queryObjects(
    datasourceId: string,
    options?: QueryOptions,
    signal?: AbortSignal,
  ): Promise<QueryResult> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.orderBy) {
      params.set('sortByIndex', options.orderBy);
    }
    if (options?.sortOrder) {
      params.set('sortOrder', options.sortOrder);
    }
    if (options?.explain) {
      params.set('explain', 'true');
    }
    if (options?.filter) {
      Object.entries(options.filter).forEach(([key, value]) => {
        params.set(`filter[${key}]`, value);
      });
    }
    const queryString = params.toString();
    const path = `/objects/${datasourceId}${
      queryString ? `?${queryString}` : ''
    }`;
    return this.request<QueryResult>(path, signal ? { signal } : undefined);
  }

  async searchObjects(
    options: SearchObjectsOptions,
    signal?: AbortSignal,
  ): Promise<SearchResult> {
    const params = new URLSearchParams();
    params.set('q', options.q);
    if (options.datasourceIds && options.datasourceIds.length > 0) {
      params.set('datasourceIds', options.datasourceIds.join(','));
    }
    if (options.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    return this.request<SearchResult>(
      `/search?${params.toString()}`,
      signal ? { signal } : undefined,
    );
  }

  async getObject(
    datastoreId: string,
    objectId: string,
  ): Promise<DatastoreObjectWithRelationships> {
    const path = `/objects/${datastoreId}/${encodeURIComponent(objectId)}`;
    return this.request<DatastoreObjectWithRelationships>(path);
  }

  async addObject(
    datastoreId: string,
    input: CreateObjectInput,
  ): Promise<void> {
    await this.request<void>(`/objects/${datastoreId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async replaceObjects(
    datastoreId: string,
    items: CreateObjectInput[],
  ): Promise<void> {
    const itemsWithDatasourceId = items.map(item => ({
      ...item,
      datasourceId: datastoreId,
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: item.updatedAt || new Date().toISOString(),
    }));
    await this.request<void>(`/objects/${datastoreId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: itemsWithDatasourceId }),
    });
  }

  async deleteObject(datastoreId: string, objectId: string): Promise<void> {
    await this.request<void>(
      `/objects/${datastoreId}/${encodeURIComponent(objectId)}`,
      {
        method: 'DELETE',
      },
    );
  }

  async deleteAllObjects(datastoreId: string): Promise<void> {
    await this.request<void>(`/objects/${datastoreId}`, {
      method: 'DELETE',
    });
  }

  async listIndexConfigurations(
    datastoreId: string,
    signal?: AbortSignal,
  ): Promise<IndexConfiguration[]> {
    const result = await this.request<{ items: IndexConfiguration[] }>(
      `/indexes/${datastoreId}`,
      signal ? { signal } : undefined,
    );
    return result.items;
  }

  async getIndexConfiguration(
    datastoreId: string,
    key: string,
  ): Promise<IndexConfiguration> {
    return this.request<IndexConfiguration>(`/indexes/${datastoreId}/${key}`);
  }

  async listIndexValues(
    datastoreId: string,
    key: string,
    options?: { q?: string; limit?: number },
  ): Promise<string[]> {
    const params = new URLSearchParams();
    if (options?.q) {
      params.set('q', options.q);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    const queryString = params.toString();
    const path = `/indexes/${datastoreId}/${encodeURIComponent(key)}/values${
      queryString ? `?${queryString}` : ''
    }`;
    const result = await this.request<{ items: string[] }>(path);
    return result.items;
  }

  async createIndexConfiguration(
    datastoreId: string,
    input: CreateIndexConfigurationInput,
  ): Promise<void> {
    await this.request<void>(`/indexes/${datastoreId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async deleteIndexConfiguration(
    datastoreId: string,
    key: string,
  ): Promise<void> {
    await this.request<void>(`/indexes/${datastoreId}/${key}`, {
      method: 'DELETE',
    });
  }

  async deleteAllIndexConfigurations(datastoreId: string): Promise<void> {
    await this.request<void>(`/indexes/${datastoreId}`, {
      method: 'DELETE',
    });
  }

  async rebuildIndexConfiguration(
    datastoreId: string,
    key: string,
  ): Promise<void> {
    await this.request<void>(`/indexes/${datastoreId}/${key}/rebuild`, {
      method: 'POST',
    });
  }

  async upsertRelationship(input: RelationshipInput): Promise<Relationship> {
    return this.request<Relationship>('/relationships', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async createRelationship(
    input: CreateRelationshipInput,
  ): Promise<Relationship> {
    return this.upsertRelationship(input);
  }

  async upsertRelationships(
    inputs: RelationshipInput[],
  ): Promise<Relationship[]> {
    return this.request<Relationship[]>('/relationships/bulk', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relationships: inputs }),
    });
  }

  async getRelationship(id: string): Promise<Relationship | undefined> {
    try {
      return await this.request<Relationship>(`/relationships/${id}`);
    } catch (e: unknown) {
      if (e instanceof ResponseError && e.statusCode === 404) {
        return undefined;
      }
      throw e;
    }
  }

  async deleteRelationship(id: string): Promise<void> {
    await this.request<void>(`/relationships/${id}`, { method: 'DELETE' });
  }

  /** Query relationships across all objects. The endpoint filters by
   *  type/origin/rule but not by datasource — callers narrow further. */
  async queryRelationships(
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipQueryResult> {
    const params = new URLSearchParams();
    if (options?.relationshipType) {
      params.set('relationshipType', options.relationshipType);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.origin) {
      params.set('origin', options.origin);
    }
    if (options?.ruleId) {
      params.set('ruleId', options.ruleId);
    }
    if (options?.direct) {
      params.set('direct', 'true');
    }
    const queryString = params.toString();
    return this.request<RelationshipQueryResult>(
      `/relationships${queryString ? `?${queryString}` : ''}`,
    );
  }

  async queryRelationshipsBySource(
    datasourceId: string,
    objectId: string,
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipQueryResult> {
    const params = new URLSearchParams();
    if (options?.relationshipType) {
      params.set('relationshipType', options.relationshipType);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.origin) {
      params.set('origin', options.origin);
    }
    if (options?.ruleId) {
      params.set('ruleId', options.ruleId);
    }
    if (options?.direct) {
      params.set('direct', 'true');
    }
    const queryString = params.toString();
    const path = `/relationships/source/${datasourceId}/${encodeURIComponent(
      objectId,
    )}${queryString ? `?${queryString}` : ''}`;
    return this.request<RelationshipQueryResult>(path);
  }

  async queryRelationshipsByDestination(
    datasourceId: string,
    objectId: string,
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipQueryResult> {
    const params = new URLSearchParams();
    if (options?.relationshipType) {
      params.set('relationshipType', options.relationshipType);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.origin) {
      params.set('origin', options.origin);
    }
    if (options?.ruleId) {
      params.set('ruleId', options.ruleId);
    }
    if (options?.direct) {
      params.set('direct', 'true');
    }
    const queryString = params.toString();
    const path = `/relationships/destination/${datasourceId}/${encodeURIComponent(
      objectId,
    )}${queryString ? `?${queryString}` : ''}`;
    return this.request<RelationshipQueryResult>(path);
  }

  async deleteRelationshipsBySource(
    datasourceId: string,
    objectId: string,
  ): Promise<void> {
    await this.request<void>(
      `/relationships/source/${datasourceId}/${encodeURIComponent(objectId)}`,
      { method: 'DELETE' },
    );
  }

  async deleteRelationshipsByDestination(
    datasourceId: string,
    objectId: string,
  ): Promise<void> {
    await this.request<void>(
      `/relationships/destination/${datasourceId}/${encodeURIComponent(objectId)}`,
      { method: 'DELETE' },
    );
  }

  async listRelationshipTypes(datasourceId: string): Promise<string[]> {
    const result = await this.request<{ items: string[] }>(
      `/relationships/types/${datasourceId}`,
    );
    return result.items;
  }

  async queryAllObjects(
    options?: QueryAllOptions,
    signal?: AbortSignal,
  ): Promise<QueryResult> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.orderBy) {
      params.set('sortByIndex', options.orderBy);
    }
    if (options?.sortOrder) {
      params.set('sortOrder', options.sortOrder);
    }
    if (options?.datasourceIds && options.datasourceIds.length > 0) {
      params.set('datasourceIds', options.datasourceIds.join(','));
    }
    const queryString = params.toString();
    const path = `/objects${queryString ? `?${queryString}` : ''}`;
    return this.request<QueryResult>(path, signal ? { signal } : undefined);
  }

  async getObjectCountsByDatasource(): Promise<DatasourceObjectCount[]> {
    const result = await this.request<{ items: DatasourceObjectCount[] }>(
      '/objects/counts',
    );
    return result.items;
  }

  async queryRootedObjectGraph(
    options: RootedObjectGraphOptions,
    signal?: AbortSignal,
  ): Promise<RootedObjectGraphResult> {
    const params = new URLSearchParams();
    params.set('rootDatasourceId', options.rootDatasourceId);
    params.set('rootObjectId', options.rootObjectId);
    if (options.depth !== undefined) {
      params.set('depth', String(options.depth));
    }
    if (options.nodeLimit !== undefined) {
      params.set('nodeLimit', String(options.nodeLimit));
    }
    setGraphFilterParams(params, options);
    return this.request<RootedObjectGraphResult>(
      `/objects/graph/rooted?${params.toString()}`,
      signal ? { signal } : undefined,
    );
  }

  async queryObjectGraphPaths(
    options: ObjectGraphPathsOptions,
    signal?: AbortSignal,
  ): Promise<ObjectGraphPathsResult> {
    const params = new URLSearchParams();
    params.set('sourceDatasourceId', options.sourceDatasourceId);
    params.set('sourceObjectId', options.sourceObjectId);
    params.set('targetDatasourceId', options.targetDatasourceId);
    params.set('targetObjectId', options.targetObjectId);
    if (options.maxDepth !== undefined) {
      params.set('maxDepth', String(options.maxDepth));
    }
    if (options.pathLimit !== undefined) {
      params.set('pathLimit', String(options.pathLimit));
    }
    setGraphFilterParams(params, options);
    return this.request<ObjectGraphPathsResult>(
      `/objects/graph/paths?${params.toString()}`,
      signal ? { signal } : undefined,
    );
  }

  async listAllRelationshipTypes(
    options?: ListRelationshipTypesOptions,
  ): Promise<string[]> {
    const params = new URLSearchParams();
    if (options?.datasourceIds && options.datasourceIds.length > 0) {
      params.set('datasourceIds', options.datasourceIds.join(','));
    }
    const queryString = params.toString();
    const result = await this.request<{ items: string[] }>(
      `/relationships/types${queryString ? `?${queryString}` : ''}`,
    );
    return result.items;
  }

  async queryAllRelationships(
    options?: RelationshipQueryOptions,
  ): Promise<RelationshipQueryResult> {
    const params = new URLSearchParams();
    if (options?.relationshipType) {
      params.set('relationshipType', options.relationshipType);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.origin) {
      params.set('origin', options.origin);
    }
    if (options?.ruleId) {
      params.set('ruleId', options.ruleId);
    }
    const queryString = params.toString();
    const path = `/relationships${queryString ? `?${queryString}` : ''}`;
    return this.request<RelationshipQueryResult>(path);
  }

  async queryWithJoin(options: JoinQueryOptions): Promise<JoinQueryResult> {
    return this.request<JoinQueryResult>('/objects/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
  }

  async getLatestSchema(
    datasourceId: string,
  ): Promise<DatastoreSchema | undefined> {
    try {
      return await this.request<DatastoreSchema>(
        `/schemas/${datasourceId}/latest`,
      );
    } catch (e: unknown) {
      if (e instanceof ResponseError && e.statusCode === 404) {
        return undefined;
      }
      throw e;
    }
  }

  async listSchemaVersions(
    datasourceId: string,
    options?: PageOptions,
  ): Promise<{ items: DatastoreSchema[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const queryString = params.toString();
    const path = `/schemas/${datasourceId}${
      queryString ? `?${queryString}` : ''
    }`;
    return this.request<{ items: DatastoreSchema[]; total: number }>(path);
  }

  async listDatasourceSchemas(
    options?: PageOptions,
  ): Promise<{ items: DatastoreSchema[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const queryString = params.toString();
    const path = `/schemas${queryString ? `?${queryString}` : ''}`;
    return this.request<{ items: DatastoreSchema[]; total: number }>(path);
  }

  async listRelationshipRules(
    options?: RelationshipRuleListOptions,
  ): Promise<{ items: RelationshipRule[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.state) {
      params.set('state', options.state);
    }
    if (options?.reviewReason) {
      params.set('reviewReason', options.reviewReason);
    }
    const queryString = params.toString();
    const path = `/relationship-rules${queryString ? `?${queryString}` : ''}`;
    return this.request<{ items: RelationshipRule[]; total: number }>(path);
  }

  async createRelationshipRule(
    input: RelationshipRuleInput,
  ): Promise<RelationshipRule> {
    return this.request<RelationshipRule>('/relationship-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async updateRelationshipRule(
    id: string,
    input: Partial<RelationshipRuleInput>,
  ): Promise<RelationshipRule> {
    return this.request<RelationshipRule>(`/relationship-rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async applyRelationshipRule(
    id: string,
  ): Promise<{ created: number; deleted: number }> {
    return this.request<{ created: number; deleted: number }>(
      `/relationship-rules/${id}/apply`,
      { method: 'POST' },
    );
  }

  async approveRelationshipRule(
    id: string,
    options?: RelationshipRuleTransitionOptions,
  ): Promise<RelationshipRule> {
    return this.request<RelationshipRule>(`/relationship-rules/${id}/approve`, {
      method: 'POST',
      ...rankShownRequestInit(options?.rankShown),
    });
  }

  async approveRelationshipRules(ids: string[]): Promise<BulkApproveResult> {
    return this.request<BulkApproveResult>('/relationship-rules/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
  }

  async dismissRelationshipRule(
    id: string,
    options?: RelationshipRuleTransitionOptions,
  ): Promise<RelationshipRule> {
    return this.request<RelationshipRule>(`/relationship-rules/${id}/dismiss`, {
      method: 'POST',
      ...rankShownRequestInit(options?.rankShown),
    });
  }

  async disableRelationshipRule(id: string): Promise<RelationshipRule> {
    return this.request<RelationshipRule>(`/relationship-rules/${id}/disable`, {
      method: 'POST',
    });
  }

  async resetRelationshipRule(
    id: string,
    options?: RelationshipRuleTransitionOptions,
  ): Promise<RelationshipRule> {
    return this.request<RelationshipRule>(`/relationship-rules/${id}/reset`, {
      method: 'POST',
      ...rankShownRequestInit(options?.rankShown),
    });
  }

  async deleteRelationshipRule(id: string): Promise<void> {
    await this.request<void>(`/relationship-rules/${id}`, {
      method: 'DELETE',
    });
  }

  async previewRelationshipRule(
    input: RelationshipRulePreviewInput,
    options?: RelationshipRulePreviewOptions,
  ): Promise<RelationshipRulePreviewResult> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.sampleLimit !== undefined) {
      params.set('sampleLimit', String(options.sampleLimit));
    }
    if (options?.sourceObjectId) {
      params.set('sourceObjectId', options.sourceObjectId);
    }
    const queryString = params.toString();
    const path = `/relationship-rules/preview${
      queryString ? `?${queryString}` : ''
    }`;
    return this.request<RelationshipRulePreviewResult>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async inferExampleRelationshipPattern(
    input: InferExampleRelationshipPatternInput,
  ): Promise<InferExampleRelationshipPatternResult> {
    return this.request<InferExampleRelationshipPatternResult>(
      '/relationship-rules/infer-example-pattern',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
  }

  async suggestRelationships(
    datasourceId: string,
  ): Promise<SuggestRelationshipsForDatasourceResult> {
    return this.request<SuggestRelationshipsForDatasourceResult>(
      `/schemas/${datasourceId}/suggest-relationships`,
      { method: 'POST' },
    );
  }

  async suggestRelationshipsBatch(
    datasourceIds: string[],
  ): Promise<SuggestRelationshipsResult> {
    return this.request<SuggestRelationshipsResult>(
      '/schemas/suggest-relationships',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasourceIds }),
      },
    );
  }

  async listContextGroupRules(
    options?: PageOptions,
  ): Promise<{ items: ContextGroupRule[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const qs = params.toString();
    return this.request(`/context-groups/rules${qs ? `?${qs}` : ''}`);
  }

  async getContextGroupRule(id: string): Promise<ContextGroupRule | undefined> {
    try {
      return await this.request<ContextGroupRule>(
        `/context-groups/rules/${id}`,
      );
    } catch (e: unknown) {
      if (e instanceof ResponseError && e.statusCode === 404) {
        return undefined;
      }
      throw e;
    }
  }

  async createContextGroupRule(
    input: ContextGroupRuleInput,
  ): Promise<ContextGroupRule> {
    return this.request<ContextGroupRule>('/context-groups/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async updateContextGroupRule(
    id: string,
    input: Partial<ContextGroupRuleInput>,
  ): Promise<ContextGroupRule> {
    return this.request<ContextGroupRule>(`/context-groups/rules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async deleteContextGroupRule(id: string): Promise<void> {
    return this.request(`/context-groups/rules/${id}`, { method: 'DELETE' });
  }

  async materializeContextGroupRule(id: string): Promise<void> {
    return this.request(`/context-groups/rules/${id}/materialize`, {
      method: 'POST',
    });
  }

  async materializeContextGroupsForDatasource(
    datasourceId: string,
  ): Promise<void> {
    return this.request(
      `/context-groups/datasources/${datasourceId}/materialize`,
      { method: 'POST' },
    );
  }

  async listContextGroups(
    options?: PageOptions & { ruleId?: string },
  ): Promise<{ items: ContextGroup[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.ruleId) {
      params.set('ruleId', options.ruleId);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const qs = params.toString();
    return this.request(`/context-groups/groups${qs ? `?${qs}` : ''}`);
  }

  async getContextGroup(id: string): Promise<ContextGroup | undefined> {
    try {
      return await this.request<ContextGroup>(`/context-groups/groups/${id}`);
    } catch (e: unknown) {
      if (e instanceof ResponseError && e.statusCode === 404) {
        return undefined;
      }
      throw e;
    }
  }

  async getContextGroupBundle(
    id: string,
    options?: {
      memberLimit?: number;
      relationshipLimit?: number;
      datasourceIds?: string[];
    },
  ): Promise<ContextGroupBundle> {
    const params = new URLSearchParams();
    if (options?.memberLimit !== undefined) {
      params.set('memberLimit', String(options.memberLimit));
    }
    if (options?.relationshipLimit !== undefined) {
      params.set('relationshipLimit', String(options.relationshipLimit));
    }
    if (options?.datasourceIds && options.datasourceIds.length > 0) {
      params.set('datasourceIds', options.datasourceIds.join(','));
    }
    const qs = params.toString();
    return this.request<ContextGroupBundle>(
      `/context-groups/groups/${encodeURIComponent(id)}/bundle${qs ? `?${qs}` : ''}`,
    );
  }

  async listContextGroupMembers(
    groupId: string,
    options?: PageOptions,
  ): Promise<{ items: ContextGroupMember[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const qs = params.toString();
    return this.request(
      `/context-groups/groups/${groupId}/members${qs ? `?${qs}` : ''}`,
    );
  }

  async listContextGroupTitles(
    datasourceId: string,
    options?: { q?: string; limit?: number },
  ): Promise<string[]> {
    const params = new URLSearchParams();
    if (options?.q) {
      params.set('q', options.q);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    const qs = params.toString();
    const result = await this.request<{ items: string[] }>(
      `/context-groups/datasources/${datasourceId}/titles${qs ? `?${qs}` : ''}`,
    );
    return result.items;
  }

  async previewContextGroupRule(
    input: ContextGroupPreviewInput,
  ): Promise<ContextGroupPreviewResult> {
    return this.request<ContextGroupPreviewResult>('/context-groups/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async getContextGroupFieldProfiles(
    datasourceId: string,
  ): Promise<ContextGroupFieldProfiles> {
    return this.request<ContextGroupFieldProfiles>(
      `/context-groups/field-profiles/${encodeURIComponent(datasourceId)}`,
    );
  }

  /** Schema for the view builder (document keys, field trees, related types). */
  async getContextGroupViewSchema(
    ruleId: string,
  ): Promise<ContextGroupViewSchema> {
    return this.request<ContextGroupViewSchema>(
      `/context-groups/rules/${encodeURIComponent(ruleId)}/view-schema`,
    );
  }

  async listContextGroupViews(ruleId: string): Promise<ContextGroupView[]> {
    const result = await this.request<{ items: ContextGroupView[] }>(
      `/context-groups/rules/${encodeURIComponent(ruleId)}/views`,
    );
    return result.items;
  }

  async createContextGroupView(
    ruleId: string,
    input: ContextGroupViewInput,
  ): Promise<ContextGroupView> {
    return this.request<ContextGroupView>(
      `/context-groups/rules/${encodeURIComponent(ruleId)}/views`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
  }

  async updateContextGroupView(
    id: string,
    input: Partial<ContextGroupViewInput>,
  ): Promise<ContextGroupView> {
    return this.request<ContextGroupView>(
      `/context-groups/views/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
  }

  async deleteContextGroupView(id: string): Promise<void> {
    return this.request(`/context-groups/views/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  /** Render a draft template against one of the rule's materialized groups. */
  async renderContextGroupViewPreview(
    ruleId: string,
    input: { template: string; groupId: string; memberLimit?: number },
  ): Promise<{ rendered: string }> {
    return this.request<{ rendered: string }>(
      `/context-groups/rules/${encodeURIComponent(ruleId)}/views/render-preview`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
    );
  }

  /** The bundle rendered through a named view (or the rule's default when
   *  `view` is omitted). A bare `view=` is required so the backend enters
   *  rendered mode rather than returning the structured member bundle. */
  async getRenderedContextGroupBundle(
    groupId: string,
    options?: { view?: string; memberLimit?: number },
  ): Promise<RenderedContextGroupBundle> {
    const params = new URLSearchParams({
      view: options?.view ?? '',
    });
    if (options?.memberLimit !== undefined) {
      params.set('memberLimit', String(options.memberLimit));
    }
    return this.request<RenderedContextGroupBundle>(
      `/context-groups/groups/${encodeURIComponent(groupId)}/bundle?${params.toString()}`,
    );
  }

  async getContextGroupRuleGroups(
    ruleId: string,
    options?: PageOptions & { q?: string },
  ): Promise<ContextGroupPreviewResult> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.q) {
      params.set('q', options.q);
    }
    const qs = params.toString();
    return this.request(
      `/context-groups/rules/${ruleId}/groups${qs ? `?${qs}` : ''}`,
    );
  }

  async findContextGroupsByMember(
    datasourceId: string,
    objectId: string,
  ): Promise<ContextGroupMembership[]> {
    const params = new URLSearchParams({ datasourceId, objectId });
    const result = await this.request<{ items: ContextGroupMembership[] }>(
      `/context-groups/by-member?${params.toString()}`,
    );
    return result.items;
  }
}
