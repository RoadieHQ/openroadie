import { vi } from 'vitest';

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
import express from 'express';
import { createServer, Server } from 'http';
import { Knex } from 'knex';
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
  ContextGroupDao,
  DatastoreRepository,
} from './database';
import { CatalogDatastoreClient } from '@roadiehq/catalog-datastore-common';
import { allowAllScopeService } from '@roadiehq/scopes';

const scopeService = allowAllScopeService;

const testDatabases = TestDatabases.create();

const fetchApi = {
  fetch,
};

describe('catalog-datastore-backend integration', () => {
  let server: Server;
  let baseUrl: string;
  let client: CatalogDatastoreClient;
  let dbClient: Knex;

  const mockHttpAuth = {
    credentials: vi
      .fn()
      .mockResolvedValue({ principal: { type: 'user', userId: 'test' } }),
  };

  beforeAll(async () => {
    dbClient = await testDatabases.init('POSTGRES_16');
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
    const contextGroupDao = new ContextGroupDao({
      knex: dbClient,
      catalogWorkflowClient,
    });

    const router = await createRouter({
      logger,
      objectDao,
      schemaDao,
      indexDao,
      relationshipDao,
      relationshipRuleDao,
      suggestionVerdictDao,
      contextGroupDao,
      datastoreRepository,
      httpAuth: mockHttpAuth as any,
      catalogWorkflowClient,
      scopeService,
    });

    const app = express();
    app.use(express.json({ limit: '500mb' }));
    app.use(router);

    server = createServer(app);
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (typeof address === 'object' && address) {
      baseUrl = `http://127.0.0.1:${address.port}`;
    }

    const discoveryApi = {
      getBaseUrl: async () => baseUrl,
    };

    client = new CatalogDatastoreClient({ discoveryApi, fetchApi });
  }, 120_000);

  async function clearAllTables() {
    await dbClient('datastore_relation').del();
    await dbClient('datastore_relationship_rule').del();
    await dbClient('datastore_index').del();
    await dbClient('datastore').del();
    await dbClient('datastore_index_configuration').del();
  }

  async function postJson(path: string, body: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function getJson(path: string) {
    return fetch(`${baseUrl}${path}`);
  }

  afterAll(async () => {
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    if (dbClient) {
      await dbClient.destroy();
    }
  });

  describe('Objects API', () => {
    describe('queryObjects', () => {
      beforeEach(async () => {
        await clearAllTables();
      });

      it('returns empty list for a new datastore', async () => {
        const datastoreId = randomUUID();

        const result = await client.queryObjects(datastoreId);

        expect(result).toEqual({ items: [], total: 0 });
      });

      it('returns items after they are created', async () => {
        const datasourceId = randomUUID();

        await client.addObject(datasourceId, {
          id: randomUUID(),
          objectId: 'test-obj-1',
          object: { name: 'Test Object 1' },
        });

        const result = await client.queryObjects(datasourceId);

        expect(result.items).toHaveLength(1);
        expect(result.items[0].objectId).toBe('test-obj-1');
        expect(result.total).toBe(1);
      });

      it('supports pagination with limit and offset', async () => {
        const datastoreId = randomUUID();

        for (let i = 0; i < 5; i++) {
          await client.addObject(datastoreId, {
            id: randomUUID(),
            objectId: `obj-${i}`,
            object: { name: `Object ${i}` },
          });
        }

        const result = await client.queryObjects(datastoreId, {
          limit: 2,
          offset: 1,
        });

        expect(result.items).toHaveLength(2);
        expect(result.total).toBe(5);
      });
    });

    describe('replaceObjects', () => {
      beforeEach(async () => {
        await clearAllTables();
      });

      it('replaces all objects in the datastore', async () => {
        const datastoreId = randomUUID();

        await client.addObject(datastoreId, {
          id: randomUUID(),
          objectId: 'old-obj',
          object: { name: 'Old Object' },
        });

        const newItems = [
          {
            id: randomUUID(),
            objectId: 'new-obj-1',
            object: { name: 'New Object 1' },
          },
          {
            id: randomUUID(),
            objectId: 'new-obj-2',
            object: { name: 'New Object 2' },
          },
        ];

        await client.replaceObjects(datastoreId, newItems);

        const result = await client.queryObjects(datastoreId);
        expect(result.items).toHaveLength(2);
        expect(result.items.map((i: any) => i.objectId).sort()).toEqual([
          'new-obj-1',
          'new-obj-2',
        ]);
      });
    });

    describe('deleteAllObjects', () => {
      beforeEach(async () => {
        await clearAllTables();
      });

      it('deletes all objects from the datastore', async () => {
        const datastoreId = randomUUID();

        await client.addObject(datastoreId, {
          id: randomUUID(),
          objectId: 'obj-1',
          object: { name: 'Object 1' },
        });

        await client.addObject(datastoreId, {
          id: randomUUID(),
          objectId: 'obj-2',
          object: { name: 'Object 2' },
        });

        await client.deleteAllObjects(datastoreId);

        const result = await client.queryObjects(datastoreId);
        expect(result.items).toHaveLength(0);
        expect(result.total).toBe(0);
      });

      it('succeeds even when datastore is empty', async () => {
        const datastoreId = randomUUID();

        await expect(
          client.deleteAllObjects(datastoreId),
        ).resolves.not.toThrow();
      });
    });

    describe('getObject', () => {
      beforeEach(async () => {
        await clearAllTables();
      });

      it('returns a specific object', async () => {
        const datastoreId = randomUUID();
        const objectId = 'specific-obj';

        await client.addObject(datastoreId, {
          id: randomUUID(),
          objectId,
          object: { name: 'Specific Object', type: 'component' },
        });

        const result = await client.getObject(datastoreId, objectId);

        expect(result.objectId).toBe(objectId);
        const obj =
          typeof result.object === 'string'
            ? JSON.parse(result.object)
            : result.object;
        expect(obj).toEqual({ name: 'Specific Object', type: 'component' });
      });

      it('throws when object does not exist', async () => {
        const datastoreId = randomUUID();

        await expect(
          client.getObject(datastoreId, 'non-existent'),
        ).rejects.toThrow();
      });
    });

    describe('deleteObject', () => {
      beforeEach(async () => {
        await clearAllTables();
      });

      it('deletes a specific object', async () => {
        const datastoreId = randomUUID();

        await client.addObject(datastoreId, {
          id: randomUUID(),
          objectId: 'obj-to-delete',
          object: { name: 'Delete Me' },
        });

        await client.addObject(datastoreId, {
          id: randomUUID(),
          objectId: 'obj-to-keep',
          object: { name: 'Keep Me' },
        });

        await client.deleteObject(datastoreId, 'obj-to-delete');

        const result = await client.queryObjects(datastoreId);
        expect(result.items).toHaveLength(1);
        expect(result.items[0].objectId).toBe('obj-to-keep');
      });

      it('succeeds even when object does not exist', async () => {
        const datastoreId = randomUUID();

        await expect(
          client.deleteObject(datastoreId, 'non-existent'),
        ).resolves.not.toThrow();
      });
    });
  });

  describe('Index Configurations API', () => {
    describe('listIndexConfigurations', () => {
      beforeEach(async () => {
        await clearAllTables();
      });

      it('returns empty list for a new datastore', async () => {
        const datastoreId = randomUUID();

        const result = await client.listIndexConfigurations(datastoreId);

        expect(result).toEqual([]);
      });

      it('returns configurations after they are created', async () => {
        const datastoreId = randomUUID();

        await client.createIndexConfiguration(datastoreId, {
          key: 'name',
          valueExpression: 'name',
        });

        const result = await client.listIndexConfigurations(datastoreId);

        expect(result).toHaveLength(1);
        expect(result[0].key).toBe('name');
        expect(result[0].valueExpression).toBe('name');
      });
    });

    describe('getIndexConfiguration', () => {
      beforeEach(async () => {
        await clearAllTables();
      });

      it('returns a specific index configuration', async () => {
        const datastoreId = randomUUID();

        await client.createIndexConfiguration(datastoreId, {
          key: 'owner',
          valueExpression: 'spec.owner',
        });

        const result = await client.getIndexConfiguration(datastoreId, 'owner');

        expect(result.key).toBe('owner');
        expect(result.valueExpression).toBe('spec.owner');
      });

      it('throws when configuration does not exist', async () => {
        const datastoreId = randomUUID();

        await expect(
          client.getIndexConfiguration(datastoreId, 'non-existent'),
        ).rejects.toThrow();
      });
    });

    describe('deleteIndexConfiguration', () => {
      beforeEach(async () => {
        await clearAllTables();
      });

      it('deletes a specific index configuration', async () => {
        const datastoreId = randomUUID();

        await client.createIndexConfiguration(datastoreId, {
          key: 'key-to-delete',
          valueExpression: 'a.b',
        });

        await client.createIndexConfiguration(datastoreId, {
          key: 'key-to-keep',
          valueExpression: 'c.d',
        });

        await client.deleteIndexConfiguration(datastoreId, 'key-to-delete');

        const configs = await client.listIndexConfigurations(datastoreId);
        expect(configs).toHaveLength(1);
        expect(configs[0].key).toBe('key-to-keep');
      });
    });

    describe('deleteAllIndexConfigurations', () => {
      beforeEach(async () => {
        await clearAllTables();
      });

      it('deletes all index configurations', async () => {
        const datastoreId = randomUUID();

        await client.createIndexConfiguration(datastoreId, {
          key: 'key1',
          valueExpression: 'a',
        });

        await client.createIndexConfiguration(datastoreId, {
          key: 'key2',
          valueExpression: 'b',
        });

        await client.deleteAllIndexConfigurations(datastoreId);

        const configs = await client.listIndexConfigurations(datastoreId);
        expect(configs).toHaveLength(0);
      });
    });
  });

  describe('Relationship Rules API', () => {
    beforeEach(async () => {
      await clearAllTables();
    });

    it('creates and applies a relationship rule, then queries relationships by ruleId and origin', async () => {
      const sourceDatasourceId = randomUUID();
      const targetDatasourceId = randomUUID();

      await client.addObject(sourceDatasourceId, {
        id: randomUUID(),
        objectId: 'source-object',
        object: {
          kind: 'Component',
          metadata: { name: 'shared-name' },
        },
      });

      await client.addObject(targetDatasourceId, {
        id: randomUUID(),
        objectId: 'target-object',
        object: {
          kind: 'Resource',
          metadata: { name: 'shared-name' },
        },
      });

      const createRuleResponse = await postJson('/relationship-rules', {
        name: 'match-name',
        sourceDatasourceId,
        targetDatasourceId,
        sourceFieldExpression: 'metadata.name',
        targetFieldExpression: 'metadata.name',
        relationshipType: 'depends_on',
      });

      expect(createRuleResponse.status).toBe(201);
      const createdRule = await createRuleResponse.json();
      expect(createdRule.id).toBeDefined();

      const applyResponse = await postJson(
        `/relationship-rules/${createdRule.id}/apply`,
        {},
      );
      expect(applyResponse.status).toBe(200);
      expect(await applyResponse.json()).toEqual({ created: 1, deleted: 0 });

      const applyAgainResponse = await postJson(
        `/relationship-rules/${createdRule.id}/apply`,
        {},
      );
      expect(applyAgainResponse.status).toBe(200);
      expect(await applyAgainResponse.json()).toEqual({
        created: 1,
        deleted: 1,
      });

      const params = new URLSearchParams({
        ruleId: createdRule.id,
        origin: 'test',
      });
      const queryResponse = await getJson(
        `/relationships/source/${sourceDatasourceId}/source-object?${params.toString()}`,
      );

      expect(queryResponse.status).toBe(200);
      const queryResult = await queryResponse.json();
      expect(queryResult.total).toBe(1);
      expect(queryResult.items).toHaveLength(1);
      expect(queryResult.items[0]).toMatchObject({
        sourceDatasourceId,
        sourceObjectId: 'source-object',
        destinationDatasourceId: targetDatasourceId,
        destinationObjectId: 'target-object',
        relationshipType: 'depends_on',
        ruleId: createdRule.id,
        origin: 'test',
      });
    });
  });
});
