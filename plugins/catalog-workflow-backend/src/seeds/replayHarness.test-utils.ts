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

import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  NODE_TYPES,
  type WorkflowDefinition,
  type WorkflowOutput,
} from '@roadiehq/catalog-workflow-common';
import {
  HttpBackend,
  type Integration,
  type IntegrationClient,
  type PageResult,
  type RequestOptions,
} from '@roadiehq/integrations-node';
import {
  NodeRegistry,
  PagedWorkflowExecutor,
  allInputPages,
  chainedSourceNode,
  integrationSourceNode,
  scheduleTriggerNode,
  type RegisteredNodeType,
} from '@roadiehq/catalog-workflow-engine';
import { createApp, S3Storage } from '@roadiehq/mock-integrations';
import type { SecretStoreService } from '@roadiehq/secrets-node';

const { applyPresentationSelectorsToSeeds } =
  require('../../seeds/presentation') as {
    applyPresentationSelectorsToSeeds: (input: Seed[]) => Seed[];
  };

const FIXTURE_BUCKET = 'roadie-dev-mock-integration-fixtures';
const FIXTURE_PREFIX = 'fixtures';
const PROBE_KEY = 'kubernetes/GET/api/v1/namespaces__limit=500.json';
export const SKIP_WARNING =
  '[seedReplay] skipped: no AWS credentials / bucket unreachable - replay suite requires read access to roadie-dev-mock-integration-fixtures';

export interface Seed {
  name: string;
  description: string;
  integrationSlug: string;
  build: (
    integrationId: string,
  ) => Pick<WorkflowDefinition, 'nodes' | 'edges' | 'viewport'>;
}

export interface ReplayCase {
  seed: Seed;
  expectedCount: number;
  assertFields?: (items: unknown[]) => void;
}

/**
 * The slice of an Integration a replay suite must provide; host and the
 * remaining row boilerplate are filled in against the harness's mock server.
 */
export interface ReplayIntegrationSpec {
  id: string;
  slug: string;
  name: string;
  type: Integration['type'];
  authType: Integration['authType'];
  authConfig:
    | Integration['authConfig']
    | ((mockBaseUrl: string) => Integration['authConfig']);
  config?: Integration['config'];
}

export interface ReplaySuite {
  integration: ReplayIntegrationSpec;
  secrets: Record<string, string>;
  cases: ReplayCase[];
}

const logger = {
  child: () => logger,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// The engine gets EXECUTION budget and the harness races it slightly later, so
// a stuck replay fails with "Timed out waiting for replay execution" instead of
// an opaque runner timeout. Vitest's per-test default (5s) sits below both, so
// each case has to raise it — fixtures are fetched from S3 over the network, and
// on a slow link a case would otherwise die well inside its own budget.
const EXECUTION_TIMEOUT_MS = 15_000;
const EXECUTION_RACE_TIMEOUT_MS = 16_000;
const CASE_TIMEOUT_MS = 20_000;

function timeout<T>(ms: number, value: T): Promise<T> {
  return new Promise(resolve => {
    // unref: a lost race must not hold the vitest worker open for the
    // remainder of the timer.
    setTimeout(() => resolve(value), ms).unref();
  });
}

async function canReadFixtures(): Promise<boolean> {
  if (process.env.SEED_REPLAY_S3 === 'off') {
    return false;
  }

  const storage = new S3Storage(FIXTURE_BUCKET, FIXTURE_PREFIX);
  // Swallow the probe's rejection up front: when the timeout wins the race,
  // the still-pending S3 call would otherwise reject later as an unhandled
  // rejection and fail the very run this probe is meant to skip.
  const probe = storage.get(PROBE_KEY).catch(() => undefined);
  const response = await Promise.race([probe, timeout(3000, undefined)]);
  return response !== undefined;
}

export async function probeFixtureAccess(): Promise<boolean> {
  const hasAccess = await canReadFixtures();
  if (!hasAccess) {
    // CI sets SEED_REPLAY_REQUIRED once it has assumed the bucket-read role:
    // there, an unreachable bucket is a broken setup, not a reason to skip.
    if (process.env.SEED_REPLAY_REQUIRED === 'true') {
      throw new Error(
        'SEED_REPLAY_REQUIRED is set but the fixture bucket is unreachable - refusing to skip the replay suite',
      );
    }
    console.warn(SKIP_WARNING);
    process.stderr.write(`${SKIP_WARNING}\n`);
  }
  return hasAccess;
}

class ReplayIntegrationClient implements IntegrationClient {
  private readonly integrations: Map<string, Integration>;
  private readonly backend: HttpBackend;

  constructor(integrations: Integration[], backend: HttpBackend) {
    this.integrations = new Map(integrations.map(i => [i.id, i]));
    this.backend = backend;
  }

  async request(
    integrationId: string,
    options: RequestOptions,
  ): Promise<unknown> {
    const integration = await this.getRequiredIntegration(integrationId);
    return this.backend.request(integration, options);
  }

  async *requestPages(
    integrationId: string,
    options: RequestOptions,
  ): AsyncGenerator<PageResult> {
    const integration = await this.getRequiredIntegration(integrationId);
    yield* this.backend.requestPages(integration, options);
  }

  async getIntegration(
    integrationId: string,
  ): Promise<Integration | undefined> {
    return this.integrations.get(integrationId);
  }

  async listIntegrations(): Promise<Integration[]> {
    return [...this.integrations.values()];
  }

  async unregisterIntegration(_integrationId: string): Promise<void> {}

  private async getRequiredIntegration(
    integrationId: string,
  ): Promise<Integration> {
    const integration = await this.getIntegration(integrationId);
    if (!integration) {
      throw new Error(`Integration not found: ${integrationId}`);
    }
    return integration;
  }
}

function makeSecretStore(secrets: Record<string, string>): SecretStoreService {
  const secretEntries = new Map(Object.entries(secrets));
  return {
    resolver: () => ({
      resolve: async refs => {
        const resolved: Record<string, string> = {};
        for (const ref of refs) {
          const value = secretEntries.get(ref);
          if (value !== undefined) {
            resolved[`${ref}`] = value;
          }
        }
        return resolved;
      },
    }),
    writer: () => ({
      readOnly: true,
      put: async () => undefined,
      delete: async () => undefined,
      listRefs: async () => [...secretEntries.keys()],
      exists: async ref => secretEntries.has(ref),
    }),
    info: () => ({ mode: 'env', readOnly: true }),
  };
}

function makeCaptureSink(captured: unknown[][]): RegisteredNodeType {
  return {
    type: NODE_TYPES.SINK_DATASTORE,
    category: 'sink',
    label: 'Capture datastore sink',
    description: 'Captures items for seed replay assertions',
    icon: 'stacked',
    color: '#ef4444',
    configSchema: { type: 'object', properties: {} },
    inputs: [{ id: 'default', label: 'Data', type: 'any', required: true }],
    outputs: [{ id: 'default', label: 'Passthrough', type: 'any' }],
    async pagedHandler(ctx) {
      for await (const page of allInputPages(ctx.io)) {
        captured.push(page.map(item => item.object));
        await ctx.io.emit(page);
      }
      return undefined;
    },
  };
}

function makeRegistry(captured: unknown[][]): NodeRegistry {
  const registry = new NodeRegistry({ logger });
  registry.registerAll([
    scheduleTriggerNode,
    integrationSourceNode,
    chainedSourceNode,
    makeCaptureSink(captured),
  ]);
  return registry;
}

/**
 * Dry-run replays never touch the DB substrate; the executor still demands
 * the DAOs, so hand it stand-ins that throw loudly if ever reached.
 */
function inertSubstrate<T>(): T {
  return new Proxy(
    {},
    {
      get() {
        throw new Error('dry-run replays must not touch the DB substrate');
      },
    },
  ) as never;
}

function makeIntegrationRow(
  spec: ReplayIntegrationSpec,
  port: number,
): Integration {
  const now = '2026-01-01T00:00:00Z';
  const host = `http://127.0.0.1:${port}/${spec.slug}`;
  return {
    ...spec,
    authConfig:
      typeof spec.authConfig === 'function'
        ? spec.authConfig(host)
        : spec.authConfig,
    host,
    requestsPerHour: 36000,
    backendType: 'http',
    config: spec.config ?? {},
    createdBy: 'seed-replay',
    createdAt: now,
    updatedAt: now,
  };
}

function makeWorkflow(seed: Seed, integrationId: string): WorkflowDefinition {
  const built = seed.build(integrationId);
  return {
    id: `workflow-${integrationId}-${seed.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}`,
    name: seed.name,
    slug: seed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    description: seed.description,
    version: 1,
    workflowType: 'data-ingestion',
    nodes: built.nodes,
    edges: built.edges,
    viewport: built.viewport,
    enabled: true,
    createdBy: 'seed-replay',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

async function runWorkflow(
  seed: Seed,
  suite: ReplaySuite,
  integrationClient: IntegrationClient,
): Promise<{ output: WorkflowOutput; capturedItems: unknown[] }> {
  const captured: unknown[][] = [];
  const executor = new PagedWorkflowExecutor({
    logger,
    nodeRegistry: makeRegistry(captured),
    integrationClient,
    getSecret: async name => suite.secrets[`${name}`],
    executionTimeoutMs: EXECUTION_TIMEOUT_MS,
    attemptDao: inertSubstrate(),
    stagingDao: inertSubstrate(),
    eventDao: inertSubstrate(),
    publisher: inertSubstrate(),
    substrateKnex: inertSubstrate(),
  });

  const workflow = makeWorkflow(seed, suite.integration.id);
  const run = executor.executeDryRun(workflow, { triggeredBy: 'seed-replay' });
  const result = await Promise.race([
    run,
    timeout<undefined>(EXECUTION_RACE_TIMEOUT_MS, undefined),
  ]);

  if (!result) {
    // Swallow the lost race's eventual rejection so it can't surface as an
    // unhandled rejection after this case has already failed.
    run.catch(() => undefined);
    throw new Error('Timed out waiting for replay execution');
  }
  expect(result.output.stats.nodesFailed).toBe(0);

  return {
    output: result.output,
    capturedItems: captured.flat(),
  };
}

type JsonObject = Record<string, unknown>;

export function findRecord(
  items: unknown[],
  predicate: (record: JsonObject) => boolean,
) {
  return items
    .filter(
      (item): item is JsonObject => item !== null && typeof item === 'object',
    )
    .find(predicate);
}

export function metadataName(record: JsonObject): string | undefined {
  const metadata = record.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return undefined;
  }
  const name = (metadata as JsonObject).name;
  return typeof name === 'string' ? name : undefined;
}

export function seedByName(seeds: Seed[], name: string): Seed {
  const seed = seeds.find(s => s.name === name);
  if (!seed) {
    throw new Error(`Seed not found: ${name}`);
  }
  return seed;
}

export function loadSeeds(module: string): Seed[] {
  const loaded = require(`../../seeds/${module}`) as
    | Seed[]
    | { default?: Seed[] };
  const seeds = Array.isArray(loaded) ? loaded : (loaded.default ?? []);
  return applyPresentationSelectorsToSeeds(seeds);
}

/**
 * Registers a replay describe-block for one integration: boots the mock
 * server against the fixture bucket, runs every seed workflow through the
 * real engine, and asserts the captured item counts. Skips loudly when the
 * bucket is unreachable.
 */
export function runReplayCases(
  hasFixtureAccess: boolean,
  suite: ReplaySuite,
): void {
  describe.skipIf(!hasFixtureAccess)(
    `${suite.integration.slug} seed replay`,
    () => {
      let server: Server;
      let integrationClient: IntegrationClient;

      beforeAll(async () => {
        const storage = new S3Storage(FIXTURE_BUCKET, FIXTURE_PREFIX);
        server = await new Promise<Server>(resolve => {
          const listening = createApp(storage).listen(0, () =>
            resolve(listening),
          );
        });
        const address = server.address();
        if (!address || typeof address === 'string') {
          throw new Error('Mock integrations server did not bind a TCP port');
        }

        const backend = new HttpBackend({
          logger,
          secretStore: makeSecretStore(suite.secrets),
          envVarAllowList: new Set(Object.keys(suite.secrets)),
          blockPrivateNetworks: false,
        });
        integrationClient = new ReplayIntegrationClient(
          [makeIntegrationRow(suite.integration, address.port)],
          backend,
        );
      });

      afterAll(async () => {
        await new Promise<void>((resolve, reject) => {
          server.close(error => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      });

      for (const replayCase of suite.cases) {
        it(
          replayCase.seed.name,
          async () => {
            const { capturedItems } = await runWorkflow(
              replayCase.seed,
              suite,
              integrationClient,
            );

            expect(capturedItems).toHaveLength(replayCase.expectedCount);
            replayCase.assertFields?.(capturedItems);
          },
          CASE_TIMEOUT_MS,
        );
      }
    },
  );
}
