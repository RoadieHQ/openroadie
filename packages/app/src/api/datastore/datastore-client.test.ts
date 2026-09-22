import { ResponseError } from '../infrastructure/errors';
import {
  CatalogDatastoreClient,
  isDirectRelationship,
  type Relationship,
} from './datastore-client';
import {
  mockResponse,
  mockNoContent,
  mockFetchFn,
} from '../infrastructure/test-utils';

describe('isDirectRelationship', () => {
  it('is true for an edge without a ruleId', () => {
    expect(isDirectRelationship({ ruleId: null } as Relationship)).toBe(true);
  });

  it('is false for a rule-materialized edge, even with origin manual', () => {
    expect(
      isDirectRelationship({
        ruleId: 'rule-1',
        origin: 'manual',
      } as Relationship),
    ).toBe(false);
  });
});

describe('CatalogDatastoreClient', () => {
  const baseUrl = 'http://test/api/datastore';
  let mockFetch: ReturnType<typeof mockFetchFn>;
  let client: CatalogDatastoreClient;

  beforeEach(() => {
    mockFetch = mockFetchFn();
    client = new CatalogDatastoreClient(baseUrl, mockFetch);
  });

  describe('queryAllObjects', () => {
    it('calls GET /objects with no params when options are omitted', async () => {
      mockFetch.mockResolvedValue(mockResponse({ items: [], total: 0 }));
      await client.queryAllObjects();
      expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/objects`, undefined);
    });

    it('appends limit and offset as query params', async () => {
      mockFetch.mockResolvedValue(mockResponse({ items: [], total: 5 }));
      await client.queryAllObjects({ limit: 10, offset: 20 });
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/objects?limit=10&offset=20`,
        undefined,
      );
    });

    it('appends sort params when provided', async () => {
      mockFetch.mockResolvedValue(mockResponse({ items: [], total: 5 }));
      await client.queryAllObjects({
        limit: 10,
        offset: 20,
        orderBy: 'relationshipCount',
        sortOrder: 'desc',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/objects?limit=10&offset=20&sortByIndex=relationshipCount&sortOrder=desc`,
        undefined,
      );
    });

    it('returns the query result', async () => {
      const payload = {
        items: [{ id: '1', datasourceId: 'ds', objectId: 'o1', object: {} }],
        total: 1,
      };
      mockFetch.mockResolvedValue(mockResponse(payload));
      const result = await client.queryAllObjects();
      expect(result).toEqual(payload);
    });

    it('forwards request cancellation', async () => {
      mockFetch.mockResolvedValue(mockResponse({ items: [], total: 0 }));
      const controller = new AbortController();

      await client.queryAllObjects(undefined, controller.signal);

      expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/objects`, {
        signal: controller.signal,
      });
    });
  });

  describe('getObjectCountsByDatasource', () => {
    it('calls GET /objects/counts and unwraps items', async () => {
      const items = [
        { datasourceId: 'ds-1', count: 17 },
        { datasourceId: 'ds-2', count: 3 },
      ];
      mockFetch.mockResolvedValue(mockResponse({ items }));

      const result = await client.getObjectCountsByDatasource();

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/objects/counts`,
        undefined,
      );
      expect(result).toEqual(items);
    });
  });

  describe('queryRootedObjectGraph', () => {
    const emptyRooted = {
      nodes: [],
      relationships: [],
      totals: { objects: 0, relationships: 0 },
      truncated: false,
      rootNodeId: 'ds-1:o1',
    };

    it('calls GET /objects/graph/rooted with the root ref', async () => {
      mockFetch.mockResolvedValue(mockResponse(emptyRooted));
      const controller = new AbortController();

      const result = await client.queryRootedObjectGraph(
        {
          rootDatasourceId: 'ds-1',
          rootObjectId: 'o1',
        },
        controller.signal,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/objects/graph/rooted?rootDatasourceId=ds-1&rootObjectId=o1`,
        { signal: controller.signal },
      );
      expect(result).toEqual(emptyRooted);
    });

    it('serializes depth, limit and every filter param', async () => {
      mockFetch.mockResolvedValue(mockResponse(emptyRooted));

      await client.queryRootedObjectGraph({
        rootDatasourceId: 'ds-1',
        rootObjectId: 'o/1',
        depth: 3,
        nodeLimit: 200,
        datasourceIds: ['ds-1', 'ds-2'],
        relationshipTypes: ['owns', 'uses'],
        origin: 'rule',
        direction: 'out',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/objects/graph/rooted?rootDatasourceId=ds-1&rootObjectId=o%2F1` +
          '&depth=3&nodeLimit=200&datasourceIds=ds-1%2Cds-2' +
          '&relationshipTypes=owns%2Cuses&origin=rule&direction=out',
        undefined,
      );
    });
  });

  describe('queryObjectGraphPaths', () => {
    const emptyPaths = {
      nodes: [],
      relationships: [],
      totals: { objects: 0, relationships: 0 },
      truncated: false,
      paths: [],
    };

    it('calls GET /objects/graph/paths with both endpoint refs', async () => {
      mockFetch.mockResolvedValue(mockResponse(emptyPaths));
      const controller = new AbortController();

      const result = await client.queryObjectGraphPaths(
        {
          sourceDatasourceId: 'ds-1',
          sourceObjectId: 's',
          targetDatasourceId: 'ds-2',
          targetObjectId: 't',
        },
        controller.signal,
      );

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/objects/graph/paths?sourceDatasourceId=ds-1&sourceObjectId=s` +
          '&targetDatasourceId=ds-2&targetObjectId=t',
        { signal: controller.signal },
      );
      expect(result).toEqual(emptyPaths);
    });

    it('serializes maxDepth, pathLimit and filters', async () => {
      mockFetch.mockResolvedValue(mockResponse(emptyPaths));

      await client.queryObjectGraphPaths({
        sourceDatasourceId: 'ds-1',
        sourceObjectId: 's',
        targetDatasourceId: 'ds-2',
        targetObjectId: 't',
        maxDepth: 5,
        pathLimit: 10,
        relationshipTypes: ['owns'],
        origin: 'direct',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/objects/graph/paths?sourceDatasourceId=ds-1&sourceObjectId=s` +
          '&targetDatasourceId=ds-2&targetObjectId=t&maxDepth=5&pathLimit=10' +
          '&relationshipTypes=owns&origin=direct',
        undefined,
      );
    });
  });

  describe('listAllRelationshipTypes', () => {
    it('unwraps items and scopes by datasourceIds', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ items: ['owns', 'uses'] }),
      );
      const bare = await client.listAllRelationshipTypes();
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/relationships/types`,
        undefined,
      );
      expect(bare).toEqual(['owns', 'uses']);

      mockFetch.mockResolvedValueOnce(mockResponse({ items: [] }));
      await client.listAllRelationshipTypes({
        datasourceIds: ['ds-1', 'ds-2'],
      });
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/relationships/types?datasourceIds=ds-1%2Cds-2`,
        undefined,
      );
    });
  });

  describe('getObject', () => {
    it('calls GET /objects/:datasourceId/:objectId', async () => {
      const obj = { id: '1', objectId: 'obj-1', relationships: [] };
      mockFetch.mockResolvedValue(mockResponse(obj));
      const result = await client.getObject('ds-1', 'obj-1');
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/objects/ds-1/obj-1`,
        undefined,
      );
      expect(result).toEqual(obj);
    });
  });

  describe('listRelationshipRules', () => {
    it('calls GET /relationship-rules', async () => {
      const payload = { items: [], total: 0 };
      mockFetch.mockResolvedValue(mockResponse(payload));
      await client.listRelationshipRules();
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/relationship-rules`,
        undefined,
      );
    });

    it('passes state filter as query param', async () => {
      mockFetch.mockResolvedValue(mockResponse({ items: [], total: 0 }));
      await client.listRelationshipRules({ state: 'active' });
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/relationship-rules?state=active`,
        undefined,
      );
    });
  });

  describe('createRelationshipRule', () => {
    it('calls POST /relationship-rules with JSON body', async () => {
      const input = {
        name: 'rule-1',
        sourceDatasourceId: 'ds-a',
        targetDatasourceId: 'ds-b',
        sourceFieldExpression: '$.name',
        targetFieldExpression: '$.name',
        relationshipType: 'dependsOn',
      };
      const created = { id: 'r1', ...input, state: 'suggested' };
      mockFetch.mockResolvedValue(mockResponse(created));

      const result = await client.createRelationshipRule(input);

      expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/relationship-rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      expect(result).toEqual(created);
    });
  });

  describe('previewRelationshipRule', () => {
    it('previews an integration-backed rule with a bounded live sample', async () => {
      const input = {
        sourceDatasourceId: 'ds-a',
        targetDatasourceId: 'ds-b',
        sourceFieldExpression: '$.repo',
        targetFieldExpression: '$.slug',
        relationshipType: 'ownedBy',
        strategy: 'integration-backed' as const,
        integrationConfig: {
          integrationId: 'github',
          method: 'GET',
          path: '/repos/{value}/teams',
          responseMatchExpression: '$.slug',
        },
      };
      const preview = {
        items: [],
        total: 30,
        truncated: true,
        skippedSources: ['repo-2'],
      };
      mockFetch.mockResolvedValue(mockResponse(preview));

      const result = await client.previewRelationshipRule(input, {
        sampleLimit: 5,
        sourceObjectId: 'repo/specific',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/relationship-rules/preview?sampleLimit=5&sourceObjectId=repo%2Fspecific`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
      );
      expect(result).toEqual(preview);
    });
  });

  describe('queryRelationships', () => {
    it('appends direct=true as a query param', async () => {
      mockFetch.mockResolvedValue(mockResponse({ items: [], total: 0 }));

      await client.queryRelationships({
        relationshipType: 'ownedBy',
        direct: true,
        limit: 500,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/relationships?relationshipType=ownedBy&limit=500&direct=true`,
        undefined,
      );
    });
  });

  describe('createRelationship', () => {
    it('calls PUT /relationships with JSON body', async () => {
      const input = {
        sourceDatasourceId: 'ds-source',
        sourceObjectId: 'service-a',
        destinationDatasourceId: 'ds-target',
        destinationObjectId: 'team-a',
        relationshipType: 'ownedBy',
        reciprocalRelationshipType: 'owns',
        origin: 'manual',
      };
      const created = { id: 'rel-1', ...input };
      mockFetch.mockResolvedValue(mockResponse(created));

      const result = await client.createRelationship(input);

      expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/relationships`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      expect(result).toEqual(created);
    });
  });

  describe('deleteRelationshipRule', () => {
    it('calls DELETE /relationship-rules/:id and returns void on 204', async () => {
      mockFetch.mockResolvedValue(mockNoContent());
      const result = await client.deleteRelationshipRule('rule-42');
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/relationship-rules/rule-42`,
        { method: 'DELETE' },
      );
      expect(result).toBeUndefined();
    });
  });

  describe('relationship rule transitions', () => {
    it('approve sends no body when rankShown is omitted', async () => {
      mockFetch.mockResolvedValue(mockResponse({ id: 'rule-1' }));

      await client.approveRelationshipRule('rule-1');

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/relationship-rules/rule-1/approve`,
        { method: 'POST' },
      );
    });

    it('approve sends { rankShown } as a JSON body when given', async () => {
      mockFetch.mockResolvedValue(mockResponse({ id: 'rule-1' }));

      await client.approveRelationshipRule('rule-1', { rankShown: 3 });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/relationship-rules/rule-1/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rankShown: 3 }),
        },
      );
    });

    it('dismiss sends { rankShown } as a JSON body when given', async () => {
      mockFetch.mockResolvedValue(mockResponse({ id: 'rule-1' }));

      await client.dismissRelationshipRule('rule-1', { rankShown: 0 });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/relationship-rules/rule-1/dismiss`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rankShown: 0 }),
        },
      );
    });

    it('reset sends { rankShown } as a JSON body when given', async () => {
      mockFetch.mockResolvedValue(mockResponse({ id: 'rule-1' }));

      await client.resetRelationshipRule('rule-1', { rankShown: 1 });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/relationship-rules/rule-1/reset`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rankShown: 1 }),
        },
      );
    });

    it('sends no body when rankShown is not a non-negative integer', async () => {
      mockFetch.mockResolvedValue(mockResponse({ id: 'rule-1' }));

      await client.dismissRelationshipRule('rule-1', { rankShown: -1 });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/relationship-rules/rule-1/dismiss`,
        { method: 'POST' },
      );
    });
  });

  describe('approveRelationshipRules', () => {
    it('calls POST /relationship-rules/approve with a JSON content-type header', async () => {
      // Without the header, Express's json() body parser skips the body and
      // the bulk route 400s on an empty `{ids}` — this asserts the fix.
      const result = {
        approved: ['rule-1', 'rule-2'],
        dismissedAsInverse: [],
        failed: [],
      };
      mockFetch.mockResolvedValue(mockResponse(result));

      await client.approveRelationshipRules(['rule-1', 'rule-2']);

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/relationship-rules/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: ['rule-1', 'rule-2'] }),
        },
      );
    });
  });

  describe('listDatasourceSchemas', () => {
    it('calls GET /schemas', async () => {
      const payload = { items: [], total: 0 };
      mockFetch.mockResolvedValue(mockResponse(payload));
      await client.listDatasourceSchemas();
      expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/schemas`, undefined);
    });
  });

  describe('listContextGroupTitles', () => {
    it('calls GET /context-groups/datasources/:datasourceId/titles', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ items: ['Teams: Alpha', 'Teams: Beta'] }),
      );

      const result = await client.listContextGroupTitles('ds-1', {
        q: 'alp',
        limit: 5,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/context-groups/datasources/ds-1/titles?q=alp&limit=5`,
        undefined,
      );
      expect(result).toEqual(['Teams: Alpha', 'Teams: Beta']);
    });
  });

  describe('getContextGroupRuleGroups', () => {
    it('passes pagination and the member-text query through', async () => {
      const payload = { groups: [], totalGroups: 0 };
      mockFetch.mockResolvedValue(mockResponse(payload));

      const result = await client.getContextGroupRuleGroups('rule-1', {
        limit: 10,
        offset: 20,
        q: 'miklos',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/context-groups/rules/rule-1/groups?limit=10&offset=20&q=miklos`,
        undefined,
      );
      expect(result).toEqual(payload);
    });
  });

  describe('getLatestSchema', () => {
    it('calls GET /schemas/:datasourceId/latest', async () => {
      const schema = { id: 's1', version: 1, schema: {} };
      mockFetch.mockResolvedValue(mockResponse(schema));
      const result = await client.getLatestSchema('ds-1');
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/schemas/ds-1/latest`,
        undefined,
      );
      expect(result).toEqual(schema);
    });

    it('returns undefined on 404 instead of throwing', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ message: 'Not found' }, false, 404),
      );
      const result = await client.getLatestSchema('missing');
      expect(result).toBeUndefined();
    });
  });

  describe('getContextGroupBundle', () => {
    it('calls GET /context-groups/groups/:id/bundle with query params', async () => {
      const payload = {
        id: 'group-1',
        ruleId: 'rule-1',
        ruleName: 'Employee',
        ruleDescription: null,
        title: 'Employee: Alice',
        totalMembers: 3,
        totalInternalRelationships: 3,
        totalExternalRelationships: 4,
        datasourceIds: ['ds-1', 'ds-2'],
        members: [],
        internalRelationships: [],
        externalRelationships: [],
        annotations: [],
        datasources: [],
      };
      mockFetch.mockResolvedValue(mockResponse(payload));

      const result = await client.getContextGroupBundle('group-1', {
        memberLimit: 10,
        relationshipLimit: 20,
        datasourceIds: ['ds-1', 'ds-2'],
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/context-groups/groups/group-1/bundle?memberLimit=10&relationshipLimit=20&datasourceIds=ds-1%2Cds-2`,
        undefined,
      );
      expect(result).toEqual(payload);
    });

    it('throws ResponseError on 404', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ error: 'Context group not found' }, false, 404),
      );

      await expect(
        client.getContextGroupBundle('missing'),
      ).rejects.toMatchObject({
        name: 'ResponseError',
        statusCode: 404,
      });
    });

    it('encodes reserved characters in the group id', async () => {
      const payload = {
        id: 'group/a?b',
        ruleId: 'rule-1',
        ruleName: 'Employee',
        ruleDescription: null,
        title: 'Employee: Alice',
        totalMembers: 3,
        totalInternalRelationships: 3,
        totalExternalRelationships: 4,
        datasourceIds: [],
        members: [],
        internalRelationships: [],
        externalRelationships: [],
        annotations: [],
        datasources: [],
      };
      mockFetch.mockResolvedValue(mockResponse(payload));

      await client.getContextGroupBundle('group/a?b');

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/context-groups/groups/group%2Fa%3Fb/bundle`,
        undefined,
      );
    });
  });

  describe('error handling', () => {
    it('throws ResponseError for non-OK responses', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ message: 'Server Error' }, false, 500),
      );
      await expect(client.queryAllObjects()).rejects.toThrow(ResponseError);
    });

    it('includes the status code on the error', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ message: 'Forbidden' }, false, 403),
      );
      try {
        await client.queryAllObjects();
        throw new Error('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ResponseError);
        expect((e as ResponseError).statusCode).toBe(403);
      }
    });
  });

  describe('204 No Content handling', () => {
    it('deleteObject returns undefined for 204', async () => {
      mockFetch.mockResolvedValue(mockNoContent());
      const result = await client.deleteObject('ds-1', 'obj-1');
      expect(result).toBeUndefined();
    });

    it('addObject returns undefined for 204', async () => {
      mockFetch.mockResolvedValue(mockNoContent());
      const result = await client.addObject('ds-1', {
        id: 'i1',
        objectId: 'o1',
        object: { key: 'value' },
      });
      expect(result).toBeUndefined();
    });
  });
});
