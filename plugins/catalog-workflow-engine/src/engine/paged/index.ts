/*
 * Copyright 2026 Larder Software Limited
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

export type { PagedItem, PagedItems, InputStream, NodeIO } from './types';
export { DEFAULT_HANDLE } from './types';
export {
  sourceOrderKey,
  chainedOrderKey,
  edgePrefixedOrderKey,
  pageResultOrderKey,
  blockingResultOrderKey,
  compareOrderKeys,
  minOrderKey,
} from './order-key';
export { StagingDataPlane, InMemoryDataPlane } from './data-plane';
export type {
  PagedDataPlane,
  StagingDataPlaneOptions,
  SinkPagedItem,
  SinkPagedItems,
  MergeJoinSide,
  JoinSidePagedItem,
  JoinedPageRow,
} from './data-plane';
export {
  buildNodeInputs,
  allInputPages,
  evaluatedPages,
} from './input-streams';
export { createNodeIO } from './node-io';
export type {
  PagedNodeContext,
  PagedNodeHandler,
  PagedNodeResult,
  SinkPublishRequest,
  MergeJoinIO,
} from './node-contract';
export { PagedWorkflowExecutor } from './PagedWorkflowExecutor';
export type {
  PagedExecutorOptions,
  PagedRunOptions,
  PagedRunResult,
  PagedDryRunOptions,
  PagedDryRunResult,
  PagedNodeExecutionStore,
  PagedNodeExecutionUpdate,
  PagedRequestLogStore,
} from './PagedWorkflowExecutor';
export { PagedExecutionService } from './PagedExecutionService';
export type {
  PagedExecutionServiceOptions,
  ExecutionRowStore,
} from './PagedExecutionService';
