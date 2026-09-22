# @roadiehq/catalog-workflow-backend

Backend plugin for the catalog-workflow system. Provides the node registry, workflow execution engine, and REST API.

## Overview

This plugin handles:

- Node type registration and management
- Workflow execution orchestration
- Paged data flow between nodes
- REST API for workflow operations

## Installation

```bash
yarn add @roadiehq/catalog-workflow-backend
```

## The paged model

Nodes do not receive an input array and return an output array.
Instead they stream data as **pages** through `ctx.io`.

- A page is a `readonly PagedItem[]`, where each `PagedItem` is `{ object: JsonValue; orderKey: readonly number[] }`.
- The `orderKey` records an item's position in the overall stream so the engine can keep results deterministically ordered across pages and merges.
- A node **reads** its inputs by async-iterating pages (`for await (const page of allInputPages(ctx.io))`).
- A node **writes** its output by emitting pages (`await ctx.io.emit(items)`).

A transform reads a page, does its work, and emits a page - carrying each surviving item's `orderKey` through untouched.
A source emits pages as it fetches them, assigning a fresh `orderKey` per item with `sourceOrderKey(index)`.
A sink consumes its input pages and, on a real run, returns a publish request (see [Sinks](#sinks-and-side-effects)).

## Adding a New Node Type

### Step 1: Create the Node File

Create a new file in the appropriate category folder under `src/nodes/`:

```
src/nodes/
├── triggers/      # Entry-point nodes - their firing starts the run
├── sources/       # Data-fetching nodes that emit pages
├── transforms/    # Per-page processing nodes (filter, map, merge)
└── sinks/         # Output destinations (e.g. the datastore sink)
```

Example: `src/nodes/transforms/dedupe.ts`

```typescript
import { RegisteredNodeType, allInputPages } from '../../engine';
import type { PagedItem } from '../../engine';

export const dedupeNode: RegisteredNodeType = {
  // Metadata
  type: 'transform-dedupe', // Or a NODE_TYPES constant from @roadiehq/catalog-workflow-common
  category: 'transform',
  label: 'Deduplicate',
  description: 'Removes duplicate items based on a key expression',
  icon: 'filter_none',
  color: '#8b5cf6',
  workflowTypes: ['data-ingestion'],

  // Configuration schema (JSON Schema format)
  configSchema: {
    type: 'object',
    properties: {
      keyExpression: {
        type: 'string',
        title: 'Key Expression',
        description: 'JSONata expression to extract the unique key',
        default: '$.id',
      },
    },
    required: ['keyExpression'],
  },

  // Input/output schemas
  inputSchema: { type: 'array', items: {} },
  outputSchema: { type: 'array', items: {} },

  // Handle definitions
  inputs: [{ id: 'default', label: 'Items', type: 'array', required: true }],
  outputs: [{ id: 'default', label: 'Unique', type: 'array' }],

  // Read input pages, emit output pages
  async pagedHandler(ctx) {
    await ctx.log('info', 'Deduplicating items');

    const seen = new Set<string>();
    let kept = 0;

    for await (const page of allInputPages(ctx.io)) {
      const survivors: PagedItem[] = [];
      for (const item of page) {
        // A real node would compile keyExpression with jsonataSafe and
        // evaluate it against item.object - see filter.ts for that pattern.
        const key = JSON.stringify(item.object);
        if (!seen.has(key)) {
          seen.add(key);
          // Carry the original orderKey so ordering survives downstream.
          survivors.push(item);
        }
      }
      kept += survivors.length;
      await ctx.io.emit(survivors);
    }

    await ctx.log('info', `Reduced to ${kept} unique items`);
  },
};
```

### Step 2: Export from Category Index

Add the export to the category's index file (e.g., `src/nodes/transforms/index.ts`):

```typescript
export { filterNode } from './filter';
export { mapNode } from './map';
export { buildMergeNode } from './merge';
export { dedupeNode } from './dedupe'; // Add this line
```

### Step 3: Register in Built-in Nodes

Add to the `builtInNodes` array in `src/nodes/index.ts`.
A node with no dependencies is registered as a plain object.
A node that needs a backend service (the datastore, discovery, or the events service) is registered as a factory function `buildX(opts)` that `buildNodes` invokes with those services:

```typescript
import { filterNode, mapNode, dedupeNode } from './transforms';

const builtInNodes: Array<
  RegisteredNodeType | ((opts: BuildNodesOptions) => RegisteredNodeType)
> = [
  scheduleTriggerNode,
  integrationSourceNode,
  buildDatastoreSource,
  chainedSourceNode,
  filterNode,
  mapNode,
  dedupeNode, // Add this line
  buildMergeNode,
  buildDatastoreSink,
];
```

## Node Execution Context

Every `pagedHandler` receives a `PagedNodeContext` with these properties and methods.

### Properties

| Property            | Type                 | Description                                                        |
| ------------------- | -------------------- | ------------------------------------------------------------------ |
| `nodeId`            | `string`             | Unique node instance ID                                            |
| `nodeType`          | `string`             | Node type identifier                                               |
| `executionId`       | `string`             | Workflow execution ID                                              |
| `workflowId`        | `string`             | ID of the executing workflow                                       |
| `workflowName`      | `string`             | Name of the executing workflow                                     |
| `scopeId`           | `string?`            | Scope the execution runs in                                        |
| `config`            | `TConfig`            | Node configuration from the workflow                               |
| `io`                | `NodeIO`             | Paged input streams plus `emit` for output (see below)             |
| `logger`            | `LoggerService`      | Logger instance                                                    |
| `signal`            | `AbortSignal`        | Cancellation signal                                                |
| `dryRun`            | `boolean`            | Whether this is a dry-run execution                                |
| `previewLimit`      | `number?`            | On a dry run, the max items a source should emit                   |
| `triggeredBy`       | `string?`            | User who triggered the execution                                   |
| `integrationClient` | `IntegrationClient?` | Instrumented HTTP client, present for source nodes that fetch data |
| `sink`              | `object?`            | Present only on the sink node during a real (non-dry) run          |
| `mergeJoin`         | `MergeJoinIO?`       | Present only on merge-join nodes (`usesMergeJoin: true`)           |

### Methods

| Method                           | Description                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `log(level, message, metadata?)` | Log a message that appears in the execution event log                          |
| `getSecret(name)`                | Retrieve a secret by name (synchronous, returns `string \| undefined`)         |
| `io.emit(items)`                 | Emit a page of `PagedItem`s to downstream nodes                                |
| `allInputPages(ctx.io)`          | Helper (imported from the engine) that async-iterates every input page in turn |

> There is no `ctx.input`, `ctx.fetch`, `ctx.storeData`, or `ctx.getIngestedData` - those belonged to the removed array-in/array-out engine. Read inputs through `ctx.io`, fetch over `ctx.integrationClient`, and let the datastore sink own persistence.

## Handler Patterns

### Per-page transform

Read each input page, transform it, and emit the result - preserving each item's `orderKey`:

```typescript
async pagedHandler(ctx) {
  const { setting } = ctx.config as { setting?: string };

  let count = 0;
  for await (const page of allInputPages(ctx.io)) {
    const mapped: PagedItem[] = page.map(item => ({
      object: transform(item.object),
      orderKey: item.orderKey,
    }));
    count += mapped.length;
    await ctx.io.emit(mapped);
  }

  await ctx.log('info', `Processed ${count} items`);
}
```

See `src/nodes/transforms/filter.ts` and `src/nodes/transforms/map.ts` for the real implementations.

### Source (emit pages as you fetch)

Sources have no inputs.
They fetch data page by page and emit each page with a fresh `orderKey` from `sourceOrderKey`.
Honor `ctx.previewLimit` so a dry run reads only a bounded sample:

```typescript
async pagedHandler(ctx) {
  const maxItems = ctx.previewLimit;
  let emitted = 0;
  let offset = 0;

  for (;;) {
    const page = await fetchPage(offset);
    await ctx.io.emit(
      page.items.map((object, i) => ({
        object,
        orderKey: sourceOrderKey(emitted + i),
      })),
    );
    emitted += page.items.length;
    offset += page.items.length;

    if (page.items.length === 0 || !page.hasMore) break;
    if (maxItems && emitted >= maxItems) break;
  }
}
```

See `src/nodes/sources/datastoreSource.ts` for the real implementation.

### HTTP requests

There is no `ctx.fetch`.
Source nodes that call an external API use `ctx.integrationClient` (an instrumented `IntegrationClient` that logs each request to the execution event log) and read credentials with `ctx.getSecret(name)`:

```typescript
async pagedHandler(ctx) {
  const token = ctx.getSecret('API_TOKEN');
  // ctx.integrationClient issues the request and records it in the event log.
  // See src/nodes/sources/integrationSource.ts for the full pattern.
}
```

### Sinks and side effects

A sink consumes its input pages and, on a real run, returns a `{ publish }` request describing what to persist - the engine performs the write.
On a dry run the sink's `ctx.sink` is absent; instead of persisting, emit the preview rows through `ctx.io.emit` and return `undefined`:

```typescript
async pagedHandler(ctx) {
  for await (const page of allInputPages(ctx.io)) {
    if (ctx.sink) {
      // Real run: stage rows for the engine to publish.
      await ctx.sink.emit(page.map(item => toSinkItem(item)));
    } else {
      // Dry run: surface a preview instead of writing.
      await ctx.io.emit(page);
    }
  }

  if (!ctx.sink) return undefined;

  return { publish: { datasourceId: ctx.workflowId, strategy: 'fail' } };
}
```

See `src/nodes/sinks/datastoreSink.ts` for the real implementation.

## Dry-run behavior

Dry-run is not a per-node opt-in. Every node runs its normal `pagedHandler` on both real and dry
runs; there is no separate dry-run handler to write. `NodeTypeDefinition` still carries a
`supportsDryRun` field, but nothing reads it - it is inert metadata on the node definition and the
API shape, and a new node need not set it.

A dry run differs only in the plumbing the engine sets up:

- It runs on an in-memory data plane (`InMemoryDataPlane`) instead of staging, so nothing is persisted.
- It is bounded by `previewLimit`; sources honor `ctx.previewLimit` to cap how much they fetch, and the previewed output is captured for the UI.
- Nodes that would otherwise cause side effects check `ctx.dryRun` (or, for the sink, the absence of `ctx.sink`) and skip the effect while still emitting representative output. This is how the datastore sink turns a would-be publish into a preview.

## Editing an Existing Node Type

1. Find the node file in `src/nodes/[category]/[name].ts`
2. Modify the desired properties:
   - Update `configSchema` to add/remove configuration options
   - Update `inputs`/`outputs` for handle changes
   - Modify the `pagedHandler` function for behavior changes
3. Run tests to ensure backward compatibility

### Schema Changes

When modifying `configSchema`, consider backward compatibility:

- Adding new optional properties is safe
- Removing properties may break existing workflows
- Changing property types requires migration

## Testing Nodes

Create tests in the same directory as the node.
Call `pagedHandler` directly with a fake context whose `io.inputs` yields your pages and whose `io.emit` collects the emitted items:

```typescript
// src/nodes/transforms/dedupe.test.ts
import { vi } from 'vitest';
import { dedupeNode } from './dedupe';

describe('dedupeNode', () => {
  it('removes duplicates', async () => {
    const emitted: Array<{ object: unknown; orderKey: readonly number[] }> = [];
    const ctx = {
      config: { keyExpression: '$.id' },
      log: vi.fn(),
      io: {
        inputs: new Map([
          [
            'default',
            [
              {
                edgeId: 'e1',
                sourceNodeId: 'src',
                pages: (async function* () {
                  yield [
                    { object: { id: 1 }, orderKey: [0] },
                    { object: { id: 2 }, orderKey: [1] },
                    { object: { id: 1 }, orderKey: [2] },
                  ];
                })(),
              },
            ],
          ],
        ]),
        emit: async (items: any[]) => {
          emitted.push(...items);
        },
      },
    };

    await dedupeNode.pagedHandler!(ctx as any);

    expect(emitted.map(i => i.object)).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
```

See `src/nodes/transforms/filter.test.ts` for the paged-context helper the built-in node tests share.

## API Endpoints

| Endpoint                 | Method         | Description                          |
| ------------------------ | -------------- | ------------------------------------ |
| `/nodes`                 | GET            | List all registered node definitions |
| `/nodes/:type`           | GET            | Get a specific node definition       |
| `/workflows`             | GET/POST       | List/create workflows                |
| `/workflows/:id`         | GET/PUT/DELETE | Workflow CRUD operations             |
| `/workflows/:id/execute` | POST           | Execute a workflow                   |
| `/executions`            | GET            | List executions                      |
| `/executions/:id`        | GET            | Get execution details                |
| `/executions/:id/stream` | GET            | SSE stream for execution events      |
