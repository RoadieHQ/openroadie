import { vi } from 'vitest';

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

import express from 'express';
import request from 'supertest';
import { Knex, knex } from 'knex';
import { randomUUID } from 'crypto';
import { mockServices, TestDatabases } from '@roadiehq/backend-test-utils';
import { CatalogWorkflowClient } from '@roadiehq/catalog-workflow-common';
import { createRouter } from './api';
import {
  applyMigrations,
  ObjectDao,
  SchemaDao,
  IndexDao,
  RelationshipDao,
  RelationshipRuleDao,
  SuggestionVerdictDao,
  DatastoreRepository,
  ContextGroupDao,
} from './database';
import { allowAllScopeService } from '@roadiehq/scopes';

const scopeService = allowAllScopeService;

const DATA_SIZES = [1000, 10000];

const testDatabases = TestDatabases.create();

describe('catalog-datastore-backend performance', () => {
  vi.setConfig({ testTimeout: 30000 });
  let app: express.Express;
  let dbClient: Knex;

  const mockHttpAuth = {
    credentials: vi
      .fn()
      .mockResolvedValue({ principal: { type: 'user', userId: 'test' } }),
  };

  beforeAll(async () => {
    const baseClient = await testDatabases.init('POSTGRES_16');

    // Plan assertions need enable_seqscan = off on every connection that
    // runs an EXPLAIN. ALTER SYSTEM + pg_reload_conf() is asynchronous and
    // server-wide (the database server is shared in CI), so the setting is
    // applied per connection via the pool instead.
    dbClient = knex({
      client: 'pg',
      connection: baseClient.client.config.connection,
      pool: {
        afterCreate: (
          conn: {
            query: (sql: string, cb: (err: Error | null) => void) => void;
          },
          done: (err: Error | null, conn: unknown) => void,
        ) => {
          conn.query('SET enable_seqscan = off', err => done(err, conn));
        },
      },
    });
    await applyMigrations(dbClient);

    const logger = mockServices.logger.mock();
    const objectDao = new ObjectDao({ knex: dbClient });
    const schemaDao = new SchemaDao({ knex: dbClient });
    const indexDao = new IndexDao({ knex: dbClient, logger });
    const relationshipDao = new RelationshipDao({ knex: dbClient });
    const relationshipRuleDao = new RelationshipRuleDao({ knex: dbClient });
    const suggestionVerdictDao = new SuggestionVerdictDao({ knex: dbClient });
    const datastoreRepository = new DatastoreRepository({
      knex: dbClient,
      logger,
      objectDao,
      schemaDao,
      indexDao,
      relationshipDao,
      relationshipRuleDao,
    });

    const mockDiscovery = { getBaseUrl: async () => 'http://localhost' };
    const catalogWorkflowClient = new CatalogWorkflowClient({
      discoveryApi: mockDiscovery,
      fetchApi: { fetch },
    });

    const router = await createRouter({
      logger,
      objectDao,
      schemaDao,
      indexDao,
      relationshipDao,
      relationshipRuleDao,
      suggestionVerdictDao,
      datastoreRepository,
      contextGroupDao: new ContextGroupDao({ knex: dbClient }),
      httpAuth: mockHttpAuth as any,
      catalogWorkflowClient,
      scopeService,
    });

    app = express();
    app.use(express.json({ limit: '500mb' }));
    app.use(router);
  }, 60000);

  afterAll(async () => {
    if (dbClient) {
      await dbClient.destroy();
    }
  });

  interface ExplainPlanNode {
    'Node Type': string;
    Plans?: ExplainPlanNode[];
    [key: string]: unknown;
  }

  interface ExplainResult {
    Plan: ExplainPlanNode;
  }

  function findNodeTypes(plan: ExplainPlanNode): string[] {
    const types: string[] = [plan['Node Type']];
    if (plan.Plans) {
      for (const child of plan.Plans) {
        types.push(...findNodeTypes(child));
      }
    }
    return types;
  }

  function assertNoSeqScan(explain: ExplainResult[], context: string) {
    const nodeTypes = explain.flatMap(e => findNodeTypes(e.Plan));
    const hasSeqScan = nodeTypes.includes('Seq Scan');
    if (hasSeqScan) {
      throw new Error(
        `Query plan contains sequential scan for ${context}.\n` +
          `This indicates missing or unused indexes.\n` +
          `Node types found: ${nodeTypes.join(', ')}\n` +
          `Query plan:\n${JSON.stringify(explain, null, 2)}`,
      );
    }
  }

  async function insertIndexConfiguration(options: {
    datasourceId: string;
    key: string;
    valueExpression: string;
  }) {
    const id = randomUUID();
    await dbClient('datastore_index_configuration').insert({
      id,
      datasource_id: options.datasourceId,
      key: options.key,
      value_expression: options.valueExpression,
    });
    return id;
  }

  async function insertBulkDataWithIndexes(
    datasourceId: string,
    configs: { configId: string; key: string }[],
    count: number,
  ) {
    const batchSize = 500;
    for (let batch = 0; batch < count; batch += batchSize) {
      const currentBatchSize = Math.min(batchSize, count - batch);
      const datastoreRows = [];
      const indexRows = [];

      for (let i = 0; i < currentBatchSize; i++) {
        const idx = batch + i;
        const datastoreId = randomUUID();
        datastoreRows.push({
          id: datastoreId,
          datasource_id: datasourceId,
          object_id: `obj-${idx}`,
          object: JSON.stringify({
            name: `Object ${idx}`,
            type: idx % 2 === 0 ? 'service' : 'component',
            priority: idx % 10,
          }),
        });

        for (const config of configs) {
          let value: string;
          if (config.key === 'name') {
            value = `Object ${idx}`;
          } else if (config.key === 'type') {
            value = idx % 2 === 0 ? 'service' : 'component';
          } else {
            value = `value-${idx}`;
          }
          indexRows.push({
            id: randomUUID(),
            datastore_id: datastoreId,
            datastore_index_configuration_id: config.configId,
            key: config.key,
            value,
          });
        }
      }

      await dbClient('datastore').insert(datastoreRows);
      if (indexRows.length > 0) {
        await dbClient('datastore_index').insert(indexRows);
      }
    }
  }

  describe('query plan efficiency at scale', () => {
    describe.each(DATA_SIZES)('with %i items', dataSize => {
      let datastoreId: string;
      let nameConfigId: string;
      let typeConfigId: string;

      const noiseIds: string[] = [];

      beforeAll(async () => {
        if (!dbClient) {
          throw new Error(
            'Database not initialized - outer beforeAll may have failed',
          );
        }
        datastoreId = randomUUID();
        nameConfigId = await insertIndexConfiguration({
          datasourceId: datastoreId,
          key: 'name',
          valueExpression: 'name',
        });
        typeConfigId = await insertIndexConfiguration({
          datasourceId: datastoreId,
          key: 'type',
          valueExpression: 'type',
        });

        for (let n = 0; n < 4; n++) {
          const noiseId = randomUUID();
          noiseIds.push(noiseId);
          const noiseNameCfg = await insertIndexConfiguration({
            datasourceId: noiseId,
            key: 'name',
            valueExpression: 'name',
          });
          const noiseTypeCfg = await insertIndexConfiguration({
            datasourceId: noiseId,
            key: 'type',
            valueExpression: 'type',
          });
          await insertBulkDataWithIndexes(
            noiseId,
            [
              { configId: noiseNameCfg, key: 'name' },
              { configId: noiseTypeCfg, key: 'type' },
            ],
            dataSize,
          );
        }

        await insertBulkDataWithIndexes(
          datastoreId,
          [
            { configId: nameConfigId, key: 'name' },
            { configId: typeConfigId, key: 'type' },
          ],
          dataSize,
        );

        await dbClient.raw('ANALYZE datastore');
        await dbClient.raw('ANALYZE datastore_index');
      });

      afterAll(async () => {
        if (!dbClient) {
          return;
        }
        try {
          const allIds = [datastoreId, ...noiseIds];
          for (const id of allIds) {
            await dbClient('datastore_index')
              .whereIn(
                'datastore_index_configuration_id',
                dbClient('datastore_index_configuration')
                  .where('datasource_id', id)
                  .select('id'),
              )
              .del();
            await dbClient('datastore').where('datasource_id', id).del();
            await dbClient('datastore_index_configuration')
              .where('datasource_id', id)
              .del();
          }
        } catch (e) {
          // Cleanup failures shouldn't fail the test
        }
      });

      it('uses index scan for basic query', async () => {
        const response = await request(app).get(
          `/objects/${datastoreId}?explain=true`,
        );

        expect(response.status).toBe(200);
        expect(response.body.total).toBe(dataSize);
        expect(response.body.explain).toBeDefined();

        assertNoSeqScan(
          response.body.explain.items,
          `basic query items (${dataSize} rows)`,
        );
        assertNoSeqScan(
          response.body.explain.total,
          `basic query total (${dataSize} rows)`,
        );
      });

      it('uses index scan with pagination', async () => {
        const response = await request(app).get(
          `/objects/${datastoreId}?limit=50&offset=${Math.floor(
            dataSize / 2,
          )}&explain=true`,
        );

        expect(response.status).toBe(200);
        expect(response.body.explain).toBeDefined();

        assertNoSeqScan(
          response.body.explain.items,
          `paginated query items (${dataSize} rows)`,
        );
        assertNoSeqScan(
          response.body.explain.total,
          `paginated query total (${dataSize} rows)`,
        );
      });

      it('uses index scan with orderBy ascending', async () => {
        const response = await request(app).get(
          `/objects/${datastoreId}?sortByIndex=name&sortOrder=asc&explain=true`,
        );

        expect(response.status).toBe(200);
        expect(response.body.explain).toBeDefined();

        assertNoSeqScan(
          response.body.explain.items,
          `orderBy asc query items (${dataSize} rows)`,
        );
        assertNoSeqScan(
          response.body.explain.total,
          `orderBy asc query total (${dataSize} rows)`,
        );
      });

      it('uses index scan with orderBy descending', async () => {
        const response = await request(app).get(
          `/objects/${datastoreId}?sortByIndex=name&sortOrder=desc&explain=true`,
        );

        expect(response.status).toBe(200);
        expect(response.body.explain).toBeDefined();

        assertNoSeqScan(
          response.body.explain.items,
          `orderBy desc query items (${dataSize} rows)`,
        );
        assertNoSeqScan(
          response.body.explain.total,
          `orderBy desc query total (${dataSize} rows)`,
        );
      });

      it('uses index scan with filter', async () => {
        const response = await request(app).get(
          `/objects/${datastoreId}?filter[type]=service&explain=true`,
        );

        expect(response.status).toBe(200);
        expect(response.body.explain).toBeDefined();

        assertNoSeqScan(
          response.body.explain.items,
          `filtered query items (${dataSize} rows)`,
        );
        assertNoSeqScan(
          response.body.explain.total,
          `filtered query total (${dataSize} rows)`,
        );
      });

      it('uses index scan with filter and orderBy', async () => {
        const response = await request(app).get(
          `/objects/${datastoreId}?filter[type]=service&sortByIndex=name&sortOrder=asc&explain=true`,
        );

        expect(response.status).toBe(200);
        expect(response.body.explain).toBeDefined();

        assertNoSeqScan(
          response.body.explain.items,
          `filtered+ordered query items (${dataSize} rows)`,
        );
        assertNoSeqScan(
          response.body.explain.total,
          `filtered+ordered query total (${dataSize} rows)`,
        );
      }, 30000);

      it('uses index scan with filter, orderBy, and pagination', async () => {
        const response = await request(app).get(
          `/objects/${datastoreId}?filter[type]=component&sortByIndex=name&sortOrder=desc&limit=25&offset=10&explain=true`,
        );

        expect(response.status).toBe(200);
        expect(response.body.explain).toBeDefined();

        assertNoSeqScan(
          response.body.explain.items,
          `filtered+ordered+paginated query items (${dataSize} rows)`,
        );
        assertNoSeqScan(
          response.body.explain.total,
          `filtered+ordered+paginated query total (${dataSize} rows)`,
        );
      }, 30000);
    });
  });

  describe('write operations at scale', () => {
    describe.each(DATA_SIZES)('with %i items', dataSize => {
      describe('PUT bulk replacement', () => {
        let datastoreId: string;

        beforeAll(async () => {
          datastoreId = randomUUID();
        });

        afterAll(async () => {
          if (!dbClient) {
            return;
          }
          try {
            await dbClient('datastore_index')
              .whereIn(
                'datastore_id',
                dbClient('datastore')
                  .select('id')
                  .where('datasource_id', datastoreId),
              )
              .del();
            await dbClient('datastore')
              .where('datasource_id', datastoreId)
              .del();
            await dbClient('datastore_index_configuration')
              .where('datasource_id', datastoreId)
              .del();
          } catch (e) {
            // Cleanup failures shouldn't fail the test
          }
        });

        it(`replaces ${dataSize} items via PUT`, async () => {
          const items = Array.from({ length: dataSize }, (_, i) => ({
            id: randomUUID(),
            datasourceId: datastoreId,
            objectId: `put-obj-${i}`,
            object: {
              name: `PUT Object ${i}`,
              type: i % 2 === 0 ? 'service' : 'component',
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }));

          const response = await request(app)
            .put(`/objects/${datastoreId}`)
            .send({ items });

          expect(response.status).toBe(200);

          const listResponse = await request(app).get(
            `/objects/${datastoreId}?limit=1`,
          );
          expect(listResponse.status).toBe(200);
          expect(listResponse.body.total).toBe(dataSize);
        });
      });
    });
  });

  describe('search functionality at scale', () => {
    describe.each(DATA_SIZES)('with %i items', dataSize => {
      let datasourceId1: string;
      let datasourceId2: string;

      beforeAll(async () => {
        if (!app || !dbClient) {
          throw new Error(
            'App/database not initialized - outer beforeAll may have failed',
          );
        }
        datasourceId1 = randomUUID();
        datasourceId2 = randomUUID();

        const items1 = Array.from(
          { length: Math.floor(dataSize / 2) },
          (_, i) => ({
            id: randomUUID(),
            datasourceId: datasourceId1,
            objectId: `search-obj-1-${i}`,
            object: {
              name: `Searchable Service ${i}`,
              description: `This is a production service for handling requests ${i}`,
              type: i % 2 === 0 ? 'service' : 'component',
              metadata: {
                team: `team-${i % 5}`,
                environment: i % 3 === 0 ? 'production' : 'staging',
              },
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        );

        const items2 = Array.from(
          { length: Math.ceil(dataSize / 2) },
          (_, i) => ({
            id: randomUUID(),
            datasourceId: datasourceId2,
            objectId: `search-obj-2-${i}`,
            object: {
              name: `Database Server ${i}`,
              description: `PostgreSQL database for data storage ${i}`,
              type: i % 2 === 0 ? 'database' : 'cache',
              metadata: {
                team: `team-${i % 5}`,
                region: i % 4 === 0 ? 'us-east' : 'eu-west',
              },
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
        );

        await request(app)
          .put(`/objects/${datasourceId1}`)
          .send({ items: items1 });

        await request(app)
          .put(`/objects/${datasourceId2}`)
          .send({ items: items2 });

        await dbClient.raw('ANALYZE datastore');
      });

      afterAll(async () => {
        if (!dbClient) {
          return;
        }
        try {
          await dbClient('datastore')
            .where('datasource_id', datasourceId1)
            .del();
          await dbClient('datastore')
            .where('datasource_id', datasourceId2)
            .del();
        } catch (e) {
          // Cleanup failures shouldn't fail the test
        }
      });

      it('returns results for basic search', async () => {
        const response = await request(app).get(
          `/search?q=service&explain=true`,
        );

        expect(response.status).toBe(200);
        expect(response.body.items.length).toBeGreaterThan(0);
        expect(response.body.total).toBeGreaterThan(0);

        assertNoSeqScan(
          response.body.explain.items,
          `basic search items (${dataSize} rows)`,
        );
      });

      it('returns results for search with datasource filter', async () => {
        const response = await request(app).get(
          `/search?q=service&datasourceIds=${datasourceId1}&explain=true`,
        );

        expect(response.status).toBe(200);
        expect(response.body.items.length).toBeGreaterThan(0);
        response.body.items.forEach((item: { datasourceId: string }) => {
          expect(item.datasourceId).toBe(datasourceId1);
        });

        assertNoSeqScan(
          response.body.explain.items,
          `filtered search items (${dataSize} rows)`,
        );
      });

      it('returns results for search with pagination', async () => {
        const response = await request(app).get(
          `/search?q=service&limit=25&offset=${Math.floor(
            dataSize / 4,
          )}&explain=true`,
        );

        expect(response.status).toBe(200);
        expect(response.body.items.length).toBeLessThanOrEqual(25);

        assertNoSeqScan(
          response.body.explain.items,
          `paginated search items (${dataSize} rows)`,
        );
      });

      it('returns results for phrase search', async () => {
        const response = await request(app).get(
          `/search?q="production service"&explain=true`,
        );

        expect(response.status).toBe(200);

        assertNoSeqScan(
          response.body.explain.items,
          `phrase search items (${dataSize} rows)`,
        );
      });

      it('returns results for negation search', async () => {
        const response = await request(app).get(
          `/search?q=service -staging&explain=true`,
        );

        expect(response.status).toBe(200);

        assertNoSeqScan(
          response.body.explain.items,
          `negation search items (${dataSize} rows)`,
        );
      });

      it('returns results for multi-datasource filter', async () => {
        const response = await request(app).get(
          `/search?q=team&datasourceIds=${datasourceId1},${datasourceId2}&explain=true`,
        );

        expect(response.status).toBe(200);
        expect(response.body.items.length).toBeGreaterThan(0);

        assertNoSeqScan(
          response.body.explain.items,
          `multi-datasource search items (${dataSize} rows)`,
        );
      });
    });
  });

  describe('index configuration operations at scale', () => {
    describe.each(DATA_SIZES)('with %i items', dataSize => {
      let datasourceId: string;
      const indexCounts = [1, 5];

      beforeAll(async () => {
        if (!app) {
          throw new Error(
            'App not initialized - outer beforeAll may have failed',
          );
        }
        datasourceId = randomUUID();

        const items = Array.from({ length: dataSize }, (_, i) => ({
          id: randomUUID(),
          datasourceId: datasourceId,
          objectId: `idx-obj-${i}`,
          object: {
            name: `Object ${i}`,
            type: i % 2 === 0 ? 'service' : 'component',
            priority: String(i % 10),
            team: `team-${i % 5}`,
            owner: `owner-${i % 20}`,
            category: `cat-${i % 8}`,
            region: `region-${i % 4}`,
            environment: i % 2 === 0 ? 'production' : 'staging',
            version: `v${i % 100}`,
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));

        const response = await request(app)
          .put(`/objects/${datasourceId}`)
          .send({ items });

        if (response.status !== 200) {
          throw new Error(
            `Failed to insert ${dataSize} items: ${response.body.message}`,
          );
        }
      });

      afterAll(async () => {
        if (!dbClient) {
          return;
        }
        try {
          await dbClient('datastore_index')
            .whereIn(
              'datastore_id',
              dbClient('datastore')
                .select('id')
                .where('datasource_id', datasourceId),
            )
            .del();
          await dbClient('datastore')
            .where('datasource_id', datasourceId)
            .del();
          await dbClient('datastore_index_configuration')
            .where('datasource_id', datasourceId)
            .del();
        } catch (e) {
          // Cleanup failures shouldn't fail the test
        }
      });

      describe.each(indexCounts)('adding %i index(es)', indexCount => {
        const indexKeys = [
          'name',
          'type',
          'priority',
          'team',
          'owner',
          'status',
          'category',
          'region',
          'environment',
          'version',
        ];

        it(`creates ${indexCount} index configuration(s) and rebuilds indexes`, async () => {
          const keysToCreate = indexKeys.slice(0, indexCount);

          for (const key of keysToCreate) {
            const response = await request(app)
              .post(`/indexes/${datasourceId}`)
              .send({
                key,
                valueExpression: key,
              });

            expect(response.status).toBe(201);
          }

          const listResponse = await request(app).get(
            `/indexes/${datasourceId}`,
          );
          expect(listResponse.status).toBe(200);
          expect(listResponse.body.items).toHaveLength(indexCount);

          const indexCountDb = await dbClient('datastore_index')
            .whereIn(
              'datastore_index_configuration_id',
              dbClient('datastore_index_configuration')
                .select('id')
                .where('datasource_id', datasourceId),
            )
            .count('* as count');
          expect(Number(indexCountDb[0].count)).toBe(dataSize * indexCount);

          for (const key of keysToCreate) {
            await request(app).delete(`/indexes/${datasourceId}/${key}`);
          }
        });
      });
    });
  });
});
