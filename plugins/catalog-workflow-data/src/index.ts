/*
 * Copyright 2025 Larder Software Limited
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

export * from './types';
export {
  isExecutionStatus,
  isLogLevel,
  isNodeExecutionStatus,
  isTriggerType,
  isWorkflowDefinition,
  isWorkflowEdgeArray,
  isWorkflowNodeArray,
  isWorkflowOutput,
  isWorkflowViewport,
  parseJsonValue,
  toJsonValue,
} from './validation';
export { WorkflowDao, slugify } from './WorkflowDao';
export { ExecutionDao } from './ExecutionDao';
export { ProviderAssignmentDao } from './ProviderAssignmentDao';
export type { ProviderAssignment } from './ProviderAssignmentDao';
export { GraphLayoutDao } from './GraphLayoutDao';
export type {
  GraphLayout,
  GraphLayoutNode,
  GraphLayoutEdge,
} from './GraphLayoutDao';
export { ScheduleStateDao, MAX_CONSECUTIVE_FAILURES } from './ScheduleStateDao';
export type {
  ClaimedSchedule,
  ScheduleStateDaoOptions,
} from './ScheduleStateDao';
export type { ScheduleStatus, ScheduleStateRow } from './types';
export type {
  WorkflowExecutionAttemptRow,
  WorkflowStagingRow,
  WorkflowStagingIndexRow,
  ExecutionEventRow,
} from './types';
export { applyDatabaseMigrations } from './migrations';

export { WorkflowAttemptDao } from './WorkflowAttemptDao';
export type {
  WorkflowAttemptDaoOptions,
  StartAttemptResult,
  DisplayAttempt,
  StaleAttempt,
  HeartbeatLoopHandle,
} from './WorkflowAttemptDao';
export { WorkflowStagingDao } from './WorkflowStagingDao';
export type {
  WorkflowStagingDaoOptions,
  StagingItem,
  StagingIndexItem,
  SinkStagingItem,
  SinkStagingIndexRow,
  JoinSideItem,
  JoinedLeftRow,
  JoinedRightRow,
  ReadJoinPagesOptions,
  StagingRange,
  StagedPage,
} from './WorkflowStagingDao';
export { ExecutionEventDao } from './ExecutionEventDao';
export type {
  ExecutionEventDaoOptions,
  StoredExecutionEvent,
} from './ExecutionEventDao';
export { AttemptReaper } from './AttemptReaper';
export type { AttemptReaperOptions } from './AttemptReaper';
export {
  AttemptStartConflictError,
  FencedWriteError,
  OversizedEventError,
  PublishAbortedError,
} from './engine-errors';
export {
  StagedPublisher,
  capturePublishSnapshot,
  indexExpressionHash,
  DUPLICATE_COUNT_FIELD,
} from './StagedPublisher';
export type {
  StagedPublisherOptions,
  PublishArgs,
  PublishResult,
  PublishSnapshot,
  PublishSnapshotIndexEntry,
  StagingManifest,
  StagingManifestEntry,
} from './StagedPublisher';
