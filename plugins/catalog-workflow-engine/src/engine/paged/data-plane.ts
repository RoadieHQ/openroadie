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
import { canonicalJsonHash } from '@roadiehq/catalog-datastore-node';
import type {
  WorkflowStagingDao,
  StagingRange,
  SinkStagingIndexRow,
} from '@roadiehq/catalog-workflow-data';
import type { PagedItem, PagedItems } from './types';
import { compareOrderKeys } from './order-key';

export interface SinkPagedItem extends PagedItem {
  objectId: string;
  indexRows?: SinkStagingIndexRow[];
}

export type SinkPagedItems = readonly SinkPagedItem[];

export type MergeJoinSide = 'left' | 'right';

export interface JoinSidePagedItem extends PagedItem {
  joinKey: string | null;
}

export interface JoinedPageRow {
  left: PagedItem;
  rights: PagedItem[];
}

const MERGE_JOIN_EXPRESSION_HASH = 'merge-join';

export interface PagedDataPlane {
  writePage(nodeId: string, items: PagedItems): Promise<void>;
  writeSinkPage(nodeId: string, items: SinkPagedItems): Promise<void>;
  readPages(nodeId: string): AsyncIterable<PagedItems>;
  writeJoinSidePage(
    nodeId: string,
    side: MergeJoinSide,
    items: readonly JoinSidePagedItem[],
  ): Promise<void>;
  readJoinedPages(nodeId: string): AsyncIterable<readonly JoinedPageRow[]>;
}

export interface StagingDataPlaneOptions {
  stagingDao: WorkflowStagingDao;
  executionId: string;
  attemptId: string;
}

export class StagingDataPlane implements PagedDataPlane {
  private readonly stagingDao: WorkflowStagingDao;
  private readonly executionId: string;
  private readonly attemptId: string;

  constructor(options: StagingDataPlaneOptions) {
    this.stagingDao = options.stagingDao;
    this.executionId = options.executionId;
    this.attemptId = options.attemptId;
  }

  range(nodeId: string): StagingRange {
    return {
      executionId: this.executionId,
      attemptId: this.attemptId,
      nodeId,
    };
  }

  async writePage(nodeId: string, items: PagedItems): Promise<void> {
    if (items.length === 0) {
      return;
    }
    await this.stagingDao.appendPage(
      this.range(nodeId),
      items.map(item => ({
        orderKey: [...item.orderKey],
        objectHash: canonicalJsonHash(item.object),
        object: JSON.stringify(item.object),
      })),
    );
  }

  async writeSinkPage(nodeId: string, items: SinkPagedItems): Promise<void> {
    if (items.length === 0) {
      return;
    }
    await this.stagingDao.appendSinkPage(
      this.range(nodeId),
      items.map(item => ({
        orderKey: [...item.orderKey],
        objectId: item.objectId,
        objectHash: canonicalJsonHash(item.object),
        object: JSON.stringify(item.object),
        indexRows: item.indexRows ? [...item.indexRows] : undefined,
      })),
    );
  }

  async *readPages(nodeId: string): AsyncIterable<PagedItems> {
    for await (const page of this.stagingDao.readPages(this.range(nodeId))) {
      yield page.rows.map(
        (row): PagedItem => ({
          object: JSON.parse(row.object) as JsonValue,
          orderKey: row.order_key.map(Number),
        }),
      );
    }
  }

  private joinSideRange(nodeId: string, side: MergeJoinSide): StagingRange {
    return this.range(`${nodeId}#merge-${side}`);
  }

  async writeJoinSidePage(
    nodeId: string,
    side: MergeJoinSide,
    items: readonly JoinSidePagedItem[],
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }
    await this.stagingDao.appendJoinSidePage(
      this.joinSideRange(nodeId, side),
      items.map(item => ({
        orderKey: [...item.orderKey],
        objectHash: canonicalJsonHash(item.object),
        object: JSON.stringify(item.object),
        joinValue: item.joinKey,
      })),
      {
        configKey: `merge-${side}`,
        expressionHash: MERGE_JOIN_EXPRESSION_HASH,
      },
    );
  }

  async *readJoinedPages(
    nodeId: string,
  ): AsyncIterable<readonly JoinedPageRow[]> {
    for await (const page of this.stagingDao.readJoinPages({
      left: this.joinSideRange(nodeId, 'left'),
      right: this.joinSideRange(nodeId, 'right'),
      leftConfigKey: 'merge-left',
      rightConfigKey: 'merge-right',
    })) {
      yield page.map(row => ({
        left: {
          object: JSON.parse(row.leftObject) as JsonValue,
          orderKey: row.leftOrderKey,
        },
        rights: row.rights.map(right => ({
          object: JSON.parse(right.object) as JsonValue,
          orderKey: right.orderKey,
        })),
      }));
    }
  }
}

export class InMemoryDataPlane implements PagedDataPlane {
  private readonly pages = new Map<string, PagedItems[]>();
  private readonly joinSides = new Map<string, JoinSidePagedItem[]>();

  async writePage(nodeId: string, items: PagedItems): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const existing = this.pages.get(nodeId) ?? [];
    existing.push(items);
    this.pages.set(nodeId, existing);
  }

  async writeSinkPage(nodeId: string, items: SinkPagedItems): Promise<void> {
    await this.writePage(nodeId, items);
  }

  async *readPages(nodeId: string): AsyncIterable<PagedItems> {
    yield* this.pages.get(nodeId) ?? [];
  }

  async writeJoinSidePage(
    nodeId: string,
    side: MergeJoinSide,
    items: readonly JoinSidePagedItem[],
  ): Promise<void> {
    const key = `${nodeId}#merge-${side}`;
    const existing = this.joinSides.get(key) ?? [];
    existing.push(...items);
    this.joinSides.set(key, existing);
  }

  async *readJoinedPages(
    nodeId: string,
  ): AsyncIterable<readonly JoinedPageRow[]> {
    const bySide = (side: MergeJoinSide) =>
      [...(this.joinSides.get(`${nodeId}#merge-${side}`) ?? [])].sort((a, b) =>
        compareOrderKeys(a.orderKey, b.orderKey),
      );
    const lefts = bySide('left');
    const rights = bySide('right');
    if (lefts.length === 0) {
      return;
    }
    yield lefts.map(left => ({
      left: { object: left.object, orderKey: left.orderKey },
      rights:
        left.joinKey === null
          ? []
          : rights
              .filter(right => right.joinKey === left.joinKey)
              .map(right => ({
                object: right.object,
                orderKey: right.orderKey,
              })),
    }));
  }

  items(nodeId: string): PagedItem[] {
    return (this.pages.get(nodeId) ?? []).flatMap(page => [...page]);
  }
}
