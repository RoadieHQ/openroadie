import { beforeEach, describe, expect, it, vi } from 'vitest';
import { integrationSourceNode } from './integrationSource';
import { NODE_TYPES } from '@roadiehq/catalog-workflow-common';
import { mockServices } from '@roadiehq/backend-test-utils';
import { createNodeExecutionContext } from '../../engine/NodeExecutionContext';

describe('integrationSourceNode', () => {
  const createMockContext = (
    config: Record<string, unknown>,
    integration?: Record<string, unknown>,
    extras?: { scopeId?: string },
  ) => ({
    config,
    log: vi.fn(),
    signal: { aborted: false },
    executionId: 'test-execution-123',
    scopeId: extras?.scopeId,
    integrationClient: {
      getIntegration: vi.fn().mockReturnValue(integration),
      request: vi.fn(),
      requestPages: vi.fn(),
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('node definition', () => {
    it('exposes the expected node definition', () => {
      expect(integrationSourceNode.type).toBe(NODE_TYPES.SOURCE_INTEGRATION);
      expect(integrationSourceNode.category).toBe('source');
      expect(integrationSourceNode.supportsDryRun).toBe(true);
    });
  });

  describe('pagedHandler', () => {
    const createPagedContext = (
      config: Record<string, unknown>,
      integration?: Record<string, unknown>,
      extras?: { previewLimit?: number },
    ) => {
      const emitted: Array<{ object: unknown; orderKey: readonly number[] }> =
        [];
      return {
        emitted,
        ctx: {
          ...createMockContext(config, integration),
          previewLimit: extras?.previewLimit,
          io: {
            inputs: new Map(),
            emit: async (items: any[]) => {
              emitted.push(...items);
            },
          },
        },
      };
    };

    it('emits each fetched page with running fetch ordinals', async () => {
      const integration = {
        id: 'http-int',
        name: 'Test HTTP',
        backendType: 'http',
      };
      const { ctx, emitted } = createPagedContext(
        {
          integrationId: 'http-int',
          path: '/api/items',
          arrayExpression: '$',
          objectIdExpression: 'id',
        },
        integration,
      );

      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          yield { items: [{ id: '1' }, { id: '2' }], pageIndex: 0 };
          yield { items: [{ id: '3' }], pageIndex: 1 };
        },
      );

      await integrationSourceNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => (i.object as { id: string }).id)).toEqual([
        '1',
        '2',
        '3',
      ]);
      expect(emitted.map(i => i.orderKey)).toEqual([[0], [1], [2]]);
    });

    it('runs a personal-workspace integration source with its own integration', async () => {
      const workspaceId = '00000000-0000-4000-8000-000000000002';
      const emitted: Array<{ object: unknown }> = [];
      const integrationClient = {
        request: vi.fn(),
        getIntegration: vi.fn(async (_id: string, requested?: string) =>
          requested === workspaceId
            ? {
                id: 'personal-integration',
                name: 'Personal integration',
                backendType: 'http',
              }
            : undefined,
        ),
        listIntegrations: vi.fn(),
        unregisterIntegration: vi.fn(),
        requestPages: async function* (
          _id: string,
          options: { workspaceId?: string },
        ) {
          if (options.workspaceId === workspaceId) {
            yield { items: [{ id: 'personal-result' }], pageIndex: 0 };
          }
        },
      };
      const context = createNodeExecutionContext({
        nodeId: 'source',
        nodeType: NODE_TYPES.SOURCE_INTEGRATION,
        executionId: 'execution-1',
        workflowId: 'workflow-1',
        workflowName: 'Personal workflow',
        workspaceId,
        config: {
          integrationId: 'personal-integration',
          path: '/objects',
          arrayExpression: '$',
          objectIdExpression: 'id',
        },
        input: undefined,
        logger: mockServices.logger.mock(),
        signal: new AbortController().signal,
        dryRun: false,
        secrets: {},
        integrationClient: integrationClient as any,
      });

      await integrationSourceNode.pagedHandler!({
        ...context,
        io: {
          inputs: new Map(),
          emit: async (items: Array<{ object: unknown }>) => {
            emitted.push(...items);
          },
        },
      } as any);

      expect(emitted.map(item => item.object)).toEqual([
        { id: 'personal-result' },
      ]);
    });

    it('caps at previewLimit mid-page and stops fetching', async () => {
      const integration = {
        id: 'http-int',
        name: 'Test HTTP',
        backendType: 'http',
      };
      const { ctx, emitted } = createPagedContext(
        {
          integrationId: 'http-int',
          path: '/api/items',
          arrayExpression: '$',
          objectIdExpression: 'id',
        },
        integration,
        { previewLimit: 3 },
      );

      let secondPageFetched = false;
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          yield {
            items: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }],
            pageIndex: 0,
          };
          secondPageFetched = true;
          yield { items: [{ id: '5' }], pageIndex: 1 };
        },
      );

      await integrationSourceNode.pagedHandler!(ctx as any);

      expect(emitted).toHaveLength(3);
      expect(secondPageFetched).toBe(false);
    });

    const yieldsOnePage = (ctx: any, items: unknown[]) => {
      ctx.integrationClient.requestPages.mockImplementation(
        async function* requestPages() {
          yield { items, pageIndex: 0 };
        },
      );
    };

    it('throws when integrationId is missing', async () => {
      const { ctx } = createPagedContext({});

      await expect(
        integrationSourceNode.pagedHandler!(ctx as any),
      ).rejects.toThrow('Integration ID is required');
    });

    it('throws when the integration client is not available', async () => {
      const { ctx } = createPagedContext({ integrationId: 'test-id' });
      ctx.integrationClient = undefined as any;

      await expect(
        integrationSourceNode.pagedHandler!(ctx as any),
      ).rejects.toThrow('Integration client not available');
    });

    it('throws when the integration is not found', async () => {
      const { ctx } = createPagedContext({ integrationId: 'unknown-id' });
      ctx.integrationClient.getIntegration.mockReturnValue(undefined);

      await expect(
        integrationSourceNode.pagedHandler!(ctx as any),
      ).rejects.toThrow('Integration not found: unknown-id');
    });

    it('dispatches to the HTTP backend for http integrations', async () => {
      const { ctx, emitted } = createPagedContext(
        {
          integrationId: 'http-int',
          path: '/api/items',
          arrayExpression: '$',
          objectIdExpression: 'id',
        },
        { id: 'http-int', name: 'Test HTTP', backendType: 'http' },
      );
      yieldsOnePage(ctx, [{ id: '1', name: 'item-1' }]);

      await integrationSourceNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([{ id: '1', name: 'item-1' }]);
      expect(ctx.integrationClient.requestPages).toHaveBeenCalledWith(
        'http-int',
        expect.objectContaining({
          backendType: 'http',
          path: '/api/items',
          arrayPath: '$',
          headers: undefined,
        }),
      );
    });

    it('forwards the scopeId on the context to requestPages', async () => {
      const { ctx } = createPagedContext(
        {
          integrationId: 'http-int',
          path: '/api/items',
          arrayExpression: '$',
          objectIdExpression: 'id',
        },
        { id: 'http-int', name: 'Test HTTP', backendType: 'http' },
      );
      ctx.scopeId = 'acme';
      yieldsOnePage(ctx, [{ id: '1' }]);

      await integrationSourceNode.pagedHandler!(ctx as any);

      expect(ctx.integrationClient.requestPages).toHaveBeenCalledWith(
        'http-int',
        expect.objectContaining({ backendType: 'http', scopeId: 'acme' }),
      );
    });

    it('resolves disabled pagination mode before requestPages', async () => {
      const { ctx } = createPagedContext(
        {
          integrationId: 'http-int',
          path: '/api/items',
          arrayExpression: '$',
          objectIdExpression: 'id',
          paginationMode: 'disabled',
          pagination: { type: 'link', perPageParam: 'per_page', perPage: 100 },
        },
        { id: 'http-int', name: 'Test HTTP', backendType: 'http' },
      );
      yieldsOnePage(ctx, [{ id: '1' }]);

      await integrationSourceNode.pagedHandler!(ctx as any);

      expect(ctx.integrationClient.requestPages).toHaveBeenCalledWith(
        'http-int',
        expect.objectContaining({
          backendType: 'http',
          pagination: { type: 'none' },
          disableImplicitPagination: true,
        }),
      );
    });

    it('dispatches to the AWS backend for aws integrations', async () => {
      const { ctx, emitted } = createPagedContext(
        {
          integrationId: 'aws-int',
          accountIds: ['123456789012'],
          resourceType: 'AWS::S3::Bucket',
          regions: ['us-east-1'],
        },
        { id: 'aws-int', name: 'AWS', backendType: 'aws' },
      );
      yieldsOnePage(ctx, [
        {
          id: 'bucket-1',
          identifier: 'bucket-1',
          resourceType: 'AWS::S3::Bucket',
          accountId: '123456789012',
          region: 'us-east-1',
          properties: { BucketName: 'bucket-1' },
        },
      ]);

      await integrationSourceNode.pagedHandler!(ctx as any);

      expect(emitted).toHaveLength(1);
      expect(emitted[0].object).toMatchObject({
        identifier: 'bucket-1',
        resourceType: 'AWS::S3::Bucket',
      });
      expect(ctx.integrationClient.requestPages).toHaveBeenCalledWith(
        'aws-int',
        expect.objectContaining({
          backendType: 'aws',
          resourceType: 'AWS::S3::Bucket',
          accountIds: ['123456789012'],
          regions: ['us-east-1'],
        }),
      );
    });

    it('dispatches to AWS service API paging for service-api mode', async () => {
      const { ctx, emitted } = createPagedContext(
        {
          integrationId: 'aws-int',
          mode: 'service-api',
          accountIds: ['123456789012'],
          service: 'lambda',
          operation: 'ListFunctions',
          regions: ['eu-west-1'],
          path: '/2015-03-31/functions/',
          arrayExpression: 'Functions',
          objectIdExpression: 'FunctionArn',
          pagination: {
            type: 'cursor',
            cursorParam: 'Marker',
            nextCursorExpression: 'NextMarker',
          },
        },
        { id: 'aws-int', name: 'AWS', backendType: 'aws' },
      );
      yieldsOnePage(ctx, [
        {
          FunctionArn: 'arn:aws:lambda:eu-west-1:123456789012:function:demo',
          FunctionName: 'demo',
        },
      ]);

      await integrationSourceNode.pagedHandler!(ctx as any);

      expect(emitted.map(i => i.object)).toEqual([
        {
          FunctionArn: 'arn:aws:lambda:eu-west-1:123456789012:function:demo',
          FunctionName: 'demo',
          id: 'arn:aws:lambda:eu-west-1:123456789012:function:demo',
        },
      ]);
      expect(ctx.integrationClient.requestPages).toHaveBeenCalledWith(
        'aws-int',
        expect.objectContaining({
          backendType: 'aws',
          mode: 'service-api',
          requestKind: 'service-api-pages',
          accountIds: ['123456789012'],
          service: 'lambda',
          operation: 'ListFunctions',
          regions: ['eu-west-1'],
          path: '/2015-03-31/functions/',
          arrayPath: 'Functions',
        }),
      );
    });
  });
});
