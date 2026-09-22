import { WorkflowClient } from './workflow-client';
import {
  mockResponse,
  mockFetchFn,
  fetchCallInit,
  fetchCallBody,
} from '../infrastructure/test-utils';

describe('WorkflowClient', () => {
  const baseUrl = 'http://test/api/workflows';
  const integrationsBaseUrl = 'http://test/api/integrations';
  let mockFetch: ReturnType<typeof mockFetchFn>;
  let client: WorkflowClient;

  beforeEach(() => {
    mockFetch = mockFetchFn();
    client = new WorkflowClient({
      baseUrl,
      integrationsBaseUrl,
      fetch: mockFetch,
    });
  });

  describe('workflows', () => {
    it('list() calls GET /workflows with no params when none provided', async () => {
      const payload = { data: [], total: 0 };
      mockFetch.mockResolvedValue(mockResponse(payload));

      const result = await client.workflows.list();

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/workflows`,
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(result).toEqual(payload);
    });

    it('list() appends query params when provided', async () => {
      mockFetch.mockResolvedValue(mockResponse({ data: [], total: 0 }));

      await client.workflows.list({
        workflowType: 'data-ingestion',
        search: 'foo',
        limit: 10,
        offset: 5,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('workflowType=data-ingestion');
      expect(url).toContain('search=foo');
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=5');
    });

    it('get(id) calls GET /workflows/:id and unwraps data', async () => {
      const workflow = { id: 'w1', name: 'Test' };
      mockFetch.mockResolvedValue(mockResponse({ data: workflow }));

      const result = await client.workflows.get('w1');

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/workflows/w1`,
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(result).toEqual(workflow);
    });

    it('create(data) calls POST /workflows with body', async () => {
      const input = { name: 'New', workflowType: 'data-ingestion' };
      const created = { id: 'w2', ...input };
      mockFetch.mockResolvedValue(mockResponse({ data: created }));

      const result = await client.workflows.create(input as any);

      const [url] = mockFetch.mock.calls[0];
      const init = fetchCallInit(mockFetch, 0);
      expect(url).toBe(`${baseUrl}/workflows`);
      expect(init.method).toBe('POST');
      expect(fetchCallBody(mockFetch)).toEqual(input);
      expect(result).toEqual(created);
    });

    it('update(id, data) calls PATCH /workflows/:id', async () => {
      const updates = { name: 'Renamed' };
      const updated = { id: 'w1', name: 'Renamed' };
      mockFetch.mockResolvedValue(mockResponse({ data: updated }));

      const result = await client.workflows.update('w1', updates);

      const [url] = mockFetch.mock.calls[0];
      const init = fetchCallInit(mockFetch, 0);
      expect(url).toBe(`${baseUrl}/workflows/w1`);
      expect(init.method).toBe('PATCH');
      expect(result).toEqual(updated);
    });

    it('delete(id) calls DELETE /workflows/:id', async () => {
      mockFetch.mockResolvedValue(mockResponse({}));

      await client.workflows.delete('w1');

      const [url] = mockFetch.mock.calls[0];
      const init = fetchCallInit(mockFetch, 0);
      expect(url).toBe(`${baseUrl}/workflows/w1`);
      expect(init.method).toBe('DELETE');
    });

    it('throws ResponseError on non-ok response', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ message: 'Not found' }, false, 404),
      );

      await expect(client.workflows.get('bad')).rejects.toThrow('Not found');
    });
  });

  describe('executions', () => {
    it('execute(workflowId) calls POST /workflows/:id/execute', async () => {
      const payload = { executionId: 'exec-1' };
      mockFetch.mockResolvedValue(mockResponse(payload));

      const result = await client.executions.execute('w1');

      const [url] = mockFetch.mock.calls[0];
      const init = fetchCallInit(mockFetch, 0);
      expect(url).toBe(`${baseUrl}/workflows/w1/execute`);
      expect(init.method).toBe('POST');
      expect(init.body).toBeUndefined();
      expect(result).toEqual(payload);
    });

    it('getLatestSummaries(workflowIds) calls POST /executions/latest-summaries', async () => {
      const summaries = [
        { workflowId: 'w1', executionId: 'e1', status: 'completed' },
      ];
      mockFetch.mockResolvedValue(mockResponse({ data: summaries }));

      const result = await client.executions.getLatestSummaries(['w1', 'w2']);

      const [url] = mockFetch.mock.calls[0];
      const init = fetchCallInit(mockFetch, 0);
      expect(url).toBe(`${baseUrl}/executions/latest-summaries`);
      expect(init.method).toBe('POST');
      expect(fetchCallBody(mockFetch)).toEqual({ workflowIds: ['w1', 'w2'] });
      expect(result).toEqual(summaries);
    });

    it('getLatestSummaries(workflowIds) filters invalid ids before POST', async () => {
      const summaries = [
        { workflowId: 'w1', executionId: 'e1', status: 'completed' },
      ];
      mockFetch.mockResolvedValue(mockResponse({ data: summaries }));

      const result = await client.executions.getLatestSummaries([
        'w1',
        '',
        '   ',
        null as unknown as string,
        'w2',
      ]);

      const [url] = mockFetch.mock.calls[0];
      const init = fetchCallInit(mockFetch, 0);
      expect(url).toBe(`${baseUrl}/executions/latest-summaries`);
      expect(init.method).toBe('POST');
      expect(fetchCallBody(mockFetch)).toEqual({ workflowIds: ['w1', 'w2'] });
      expect(result).toEqual(summaries);
    });

    it('getLatestSummaries(workflowIds) returns empty and skips fetch when all ids are invalid', async () => {
      const result = await client.executions.getLatestSummaries([
        '',
        '   ',
        null as unknown as string,
      ]);

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('listByWorkflow(workflowId) calls GET /workflows/:id/executions', async () => {
      const payload = { data: [], total: 0 };
      mockFetch.mockResolvedValue(mockResponse(payload));

      const result = await client.executions.listByWorkflow('w1');

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/workflows/w1/executions`,
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(result).toEqual(payload);
    });

    it('listByWorkflow appends query params when provided', async () => {
      mockFetch.mockResolvedValue(mockResponse({ data: [], total: 0 }));

      await client.executions.listByWorkflow('w1', {
        status: 'failed',
        limit: 5,
      });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('status=failed');
      expect(url).toContain('limit=5');
    });

    it('throws ResponseError on non-ok response', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ message: 'Server error' }, false, 500),
      );

      await expect(client.executions.execute('w1')).rejects.toThrow(
        'Server error',
      );
    });
  });

  describe('integrations', () => {
    it('list() calls GET on integrations base URL', async () => {
      const integration = { id: 'i1', name: 'GitHub', updatedAt: '2024-01-01' };
      mockFetch.mockResolvedValue(
        mockResponse({ data: [integration], total: 1 }),
      );

      const result = await client.integrations.list();

      expect(mockFetch).toHaveBeenCalledWith(
        `${integrationsBaseUrl}/`,
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(result.data[0].logoUrl).toBe(
        `${integrationsBaseUrl}/i1/logo?v=2024-01-01`,
      );
    });

    it('list() turns logoSvg from the API into a data-URI logoUrl', async () => {
      const integration = {
        id: 'i1',
        name: 'Rootly',
        updatedAt: '2024-01-01',
        logoSvg:
          '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0,0"/></svg>',
      };
      mockFetch.mockResolvedValue(
        mockResponse({ data: [integration], total: 1 }),
      );

      const result = await client.integrations.list();

      expect(result.data[0].logoUrl).toMatch(/^data:image\/svg\+xml/);
      expect(result.data[0]).not.toHaveProperty('logoSvg');
    });

    it('create(data) calls POST / with body', async () => {
      const input = {
        name: 'Jira',
        slug: 'jira',
        type: 'http',
        backendType: 'http' as const,
      };
      const created = { id: 'i2', ...input, updatedAt: '2024-01-01' };
      mockFetch.mockResolvedValue(mockResponse({ data: created }));

      const result = await client.integrations.create(input);

      const [url] = mockFetch.mock.calls[0];
      const init = fetchCallInit(mockFetch, 0);
      expect(url).toBe(`${integrationsBaseUrl}/`);
      expect(init.method).toBe('POST');
      expect(result.logoUrl).toContain('/i2/logo');
    });

    it('update(id, data) calls PATCH /:id', async () => {
      const updates = { name: 'Updated' };
      const updated = { id: 'i1', name: 'Updated', updatedAt: '2024-02-01' };
      mockFetch.mockResolvedValue(mockResponse({ data: updated }));

      const result = await client.integrations.update('i1', updates);

      const [url] = mockFetch.mock.calls[0];
      const init = fetchCallInit(mockFetch, 0);
      expect(url).toBe(`${integrationsBaseUrl}/i1`);
      expect(init.method).toBe('PATCH');
      expect(result).toMatchObject({ id: 'i1', name: 'Updated' });
    });

    it('delete(id) calls DELETE /:id', async () => {
      mockFetch.mockResolvedValue(mockResponse({ success: true }));

      await client.integrations.delete('i1');

      const [url] = mockFetch.mock.calls[0];
      const init = fetchCallInit(mockFetch, 0);
      expect(url).toBe(`${integrationsBaseUrl}/i1`);
      expect(init.method).toBe('DELETE');
    });

    it('getLogoUrl(id) returns URL string without fetching', async () => {
      const url = await client.integrations.getLogoUrl('i1');

      expect(url).toBe(`${integrationsBaseUrl}/i1/logo`);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('listLogos() calls GET /logos and returns logos array', async () => {
      const logos = [{ slug: 'github', label: 'GitHub', svg: '<svg/>' }];
      mockFetch.mockResolvedValue(mockResponse({ logos }));

      const result = await client.integrations.listLogos();

      expect(mockFetch).toHaveBeenCalledWith(
        `${integrationsBaseUrl}/logos`,
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(result).toEqual(logos);
    });
  });

  describe('nodeTypes', () => {
    it('list() calls GET /nodes and returns nodes array', async () => {
      const nodes = [
        { type: 'http-source', category: 'source', label: 'HTTP' },
      ];
      mockFetch.mockResolvedValue(mockResponse({ nodes }));

      const result = await client.nodeTypes.list();

      expect(mockFetch).toHaveBeenCalledWith(`${baseUrl}/nodes`);
      expect(result).toEqual(nodes);
    });

    it('list() appends workflowType query param', async () => {
      mockFetch.mockResolvedValue(mockResponse({ nodes: [] }));

      await client.nodeTypes.list({ workflowType: 'data-ingestion' });

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain('workflowType=data-ingestion');
    });

    it('throws ResponseError on non-ok response', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ message: 'Unauthorized' }, false, 401),
      );

      await expect(client.nodeTypes.list()).rejects.toThrow('Unauthorized');
    });
  });
});
