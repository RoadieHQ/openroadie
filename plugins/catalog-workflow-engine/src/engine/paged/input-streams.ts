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

import jsonataSafe from '@roadiehq/jsonata-safe';
import type { Expression } from 'jsonata';
import type { JsonValue } from '@roadiehq/types';
import type {
  WorkflowEdge,
  EdgeTransform,
} from '@roadiehq/catalog-workflow-common';
import { PAGE_SIZE, BLOCKING_OP_CAP } from '@roadiehq/catalog-datastore-common';
import {
  classifyExpression,
  evaluateBlocking,
  normalizeToArray,
} from '../../jsonata';
import type { PagedDataPlane } from './data-plane';
import type { InputStream, NodeIO, PagedItems } from './types';
import { DEFAULT_HANDLE } from './types';
import {
  blockingResultOrderKey,
  edgePrefixedOrderKey,
  minOrderKey,
  pageResultOrderKey,
} from './order-key';

export function buildNodeInputs(options: {
  nodeId: string;
  edges: readonly WorkflowEdge[];
  plane: PagedDataPlane;
}): ReadonlyMap<string, readonly InputStream[]> {
  const { nodeId, edges, plane } = options;
  const incoming = edges.filter(edge => edge.target === nodeId);

  const byHandle = new Map<string, WorkflowEdge[]>();
  for (const edge of incoming) {
    const handle = edge.targetHandle || DEFAULT_HANDLE;
    const list = byHandle.get(handle) ?? [];
    list.push(edge);
    byHandle.set(handle, list);
  }

  const inputs = new Map<string, readonly InputStream[]>();
  for (const [handle, handleEdges] of byHandle) {
    const multiEdge = handleEdges.length > 1;
    inputs.set(
      handle,
      handleEdges.map((edge, edgeOrdinal) => ({
        edgeId: edge.id,
        sourceNodeId: edge.source,
        pages: edgePages({
          plane,
          edge,
          edgeOrdinal: multiEdge ? edgeOrdinal : undefined,
        }),
      })),
    );
  }
  return inputs;
}

function edgePages(options: {
  plane: PagedDataPlane;
  edge: WorkflowEdge;
  edgeOrdinal: number | undefined;
}): AsyncIterable<PagedItems> {
  const { plane, edge, edgeOrdinal } = options;
  const source = plane.readPages(edge.source);
  const transformed = edge.transform
    ? transformedPages(source, edge.transform)
    : source;
  return edgeOrdinal === undefined
    ? transformed
    : prefixedPages(transformed, edgeOrdinal);
}

async function* prefixedPages(
  pages: AsyncIterable<PagedItems>,
  edgeOrdinal: number,
): AsyncIterable<PagedItems> {
  for await (const page of pages) {
    yield page.map(item => ({
      object: item.object,
      orderKey: edgePrefixedOrderKey(edgeOrdinal, item.orderKey),
    }));
  }
}

async function* transformedPages(
  pages: AsyncIterable<PagedItems>,
  transform: EdgeTransform,
): AsyncIterable<PagedItems> {
  if (transform.type !== 'jsonata') {
    throw new Error(`Unknown edge transform type: ${transform.type}`);
  }
  yield* evaluatedPages(
    pages,
    transform.expression,
    jsonataSafe(transform.expression, { allowLambdas: true }),
  );
}

export async function* evaluatedPages(
  pages: AsyncIterable<PagedItems>,
  expression: string,
  compiled: Expression,
): AsyncIterable<PagedItems> {
  if (classifyExpression(expression) === 'per-page') {
    for await (const page of pages) {
      if (page.length === 0) {
        continue;
      }
      const anchor = minOrderKey(page);
      const results = normalizeToArray(
        await compiled.evaluate(page.map(item => item.object)),
      );
      if (results.length === 0) {
        continue;
      }
      yield results.map((object, i) => ({
        object: object as JsonValue,
        orderKey: pageResultOrderKey(anchor, i),
      }));
    }
    return;
  }

  const results = await evaluateBlocking(
    compiled,
    objectPages(pages),
    BLOCKING_OP_CAP,
    expression,
  );
  for (let offset = 0; offset < results.length; offset += PAGE_SIZE) {
    yield results.slice(offset, offset + PAGE_SIZE).map((object, i) => ({
      object: object as JsonValue,
      orderKey: blockingResultOrderKey(offset + i),
    }));
  }
}

async function* objectPages(
  pages: AsyncIterable<PagedItems>,
): AsyncIterable<unknown[]> {
  for await (const page of pages) {
    yield page.map(item => item.object);
  }
}

export async function* allInputPages(io: NodeIO): AsyncIterable<PagedItems> {
  for (const streams of io.inputs.values()) {
    for (const stream of streams) {
      yield* stream.pages;
    }
  }
}
