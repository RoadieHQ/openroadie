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

import type { JsonValue } from '@roadiehq/types';
import type { DuplicateObjectIdStrategy } from '@roadiehq/catalog-datastore-common';
import type { LargePayloadWarning } from '@roadiehq/catalog-workflow-common';
import type {
  PublishResult,
  PublishSnapshot,
} from '@roadiehq/catalog-workflow-data';
import type { NodeExecutionContext } from '../NodeExecutionContext';
import type { NodeIO } from './types';
import type {
  JoinSidePagedItem,
  JoinedPageRow,
  MergeJoinSide,
  SinkPagedItems,
} from './data-plane';

export interface MergeJoinIO {
  spill(
    side: MergeJoinSide,
    items: readonly JoinSidePagedItem[],
  ): Promise<void>;
  joinedPages(): AsyncIterable<readonly JoinedPageRow[]>;
}

export interface PagedNodeContext<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> extends Omit<NodeExecutionContext<TConfig, never>, 'input'> {
  io: NodeIO;
  sink?: {
    publishSnapshot: PublishSnapshot;
    emit: (items: SinkPagedItems) => Promise<void>;
  };
  mergeJoin?: MergeJoinIO;
}

export interface SinkPublishRequest {
  datasourceId: string;
  strategy: DuplicateObjectIdStrategy;
  datasourceName?: string;
  schema?: JsonValue;
  resolvedIdSelectorExpression?: string;
  largePayloadWarning?: LargePayloadWarning;
  onPublished?: (result: PublishResult) => Promise<void>;
}

export interface PagedNodeResult {
  publish?: SinkPublishRequest;
}

export type PagedNodeHandler<
  TConfig extends Record<string, unknown> = Record<string, unknown>,
> = (ctx: PagedNodeContext<TConfig>) => Promise<PagedNodeResult | void>;
