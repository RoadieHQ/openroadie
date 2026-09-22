import { constructExecuteReadActionTool } from './executeReadActionTool';

const mockDiscovery = {
  getBaseUrl: vi.fn(),
  getExternalBaseUrl: vi.fn(),
};
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

const BASE_URL = 'http://localhost:7007/api/actions';

const readAction = {
  id: 'a1',
  name: 'List repos',
  slug: 'list-repos',
  description: 'Lists repos',
  enabled: true,
  mode: null,
  effectiveMode: 'read',
  steps: [{ request: { method: 'GET' } }],
};

const writeAction = {
  id: 'a2',
  name: 'Create repo',
  slug: 'create-repo',
  description: 'Creates a repo',
  enabled: true,
  mode: null,
  effectiveMode: 'write',
  steps: [{ request: { method: 'POST' } }],
};

beforeEach(() => {
  vi.restoreAllMocks();
  mockDiscovery.getBaseUrl.mockResolvedValue(BASE_URL);
});

describe('constructExecuteReadActionTool', () => {
  it('creates the tool with read-only annotations', async () => {
    const tool = await constructExecuteReadActionTool(
      mockDiscovery as any,
      mockLogger as any,
    );

    expect(tool.name).toBe('actions_execute_read');
    expect(tool.config.annotations).toEqual({
      title: 'Run a read-only action',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  describe('callback', () => {
    let callTool: (params: {
      action: string;
      inputs?: Record<string, unknown>;
    }) => Promise<any>;
    let mockFetchClient: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const tool = await constructExecuteReadActionTool(
        mockDiscovery as any,
        mockLogger as any,
      );
      mockFetchClient = vi.fn();
      callTool = tool.cb({
        prePermissionedFetchClient: mockFetchClient,
        discovery: mockDiscovery,
      } as any) as any;
    });

    it('executes a read action resolved by slug', async () => {
      mockFetchClient
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [readAction] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ok: true,
            status: 200,
            data: { repos: [] },
            steps: [],
          }),
        });

      const result = await callTool({
        action: 'list-repos',
        inputs: { org: 'acme' },
      });

      expect(mockFetchClient).toHaveBeenNthCalledWith(
        1,
        `${BASE_URL}/?search=list-repos&offset=0`,
      );
      expect(mockFetchClient).toHaveBeenNthCalledWith(
        2,
        `${BASE_URL}/list-repos/execute`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            inputs: { org: 'acme' },
            requireEnabled: true,
          }),
        }),
      );
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        ok: true,
        status: 200,
        data: { repos: [] },
        steps: [],
      });
    });

    it('refuses a write action without executing it, pointing at actions_execute_write', async () => {
      mockFetchClient.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [writeAction] }),
      });

      const result = await callTool({ action: 'create-repo' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('write action');
      expect(result.content[0].text).toContain('actions_execute_write');
      expect(mockFetchClient).toHaveBeenCalledTimes(1);
    });

    it('refuses when a mode override marks a GET-only action as write', async () => {
      mockFetchClient.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              ...readAction,
              mode: 'write',
              effectiveMode: 'write',
            },
          ],
        }),
      });

      const result = await callTool({ action: 'list-repos' });

      expect(result.isError).toBe(true);
      expect(mockFetchClient).toHaveBeenCalledTimes(1);
    });

    it('derives mode from step methods when the backend omits effectiveMode', async () => {
      mockFetchClient
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [
              {
                ...readAction,
                mode: undefined,
                effectiveMode: undefined,
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true, status: 200, steps: [] }),
        });

      const result = await callTool({ action: 'list-repos' });

      expect(result.isError).toBeFalsy();
      expect(mockFetchClient).toHaveBeenCalledTimes(2);
    });

    it('walks paginated search results to find a slug beyond the first page', async () => {
      const filler = { ...readAction, id: 'f1', slug: 'list-repos-legacy' };
      mockFetchClient
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [filler], total: 2 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [readAction], total: 2 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true, status: 200, steps: [] }),
        });

      const result = await callTool({ action: 'list-repos' });

      expect(mockFetchClient).toHaveBeenNthCalledWith(
        1,
        `${BASE_URL}/?search=list-repos&offset=0`,
      );
      expect(mockFetchClient).toHaveBeenNthCalledWith(
        2,
        `${BASE_URL}/?search=list-repos&offset=1`,
      );
      expect(mockFetchClient).toHaveBeenNthCalledWith(
        3,
        `${BASE_URL}/list-repos/execute`,
        expect.anything(),
      );
      expect(result.isError).toBeFalsy();
    });

    it('reports not-found after exhausting all search pages', async () => {
      const filler = { ...readAction, id: 'f1', slug: 'list-repos-legacy' };
      mockFetchClient.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [filler], total: 1 }),
      });

      const result = await callTool({ action: 'list-repos' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Action 'list-repos' not found");
      expect(mockFetchClient).toHaveBeenCalledTimes(1);
    });

    it('resolves uuid references via GET /:id', async () => {
      const uuid = '3f7b6f0e-6a54-4d2f-9b7e-2d1a4c8e5b90';
      mockFetchClient
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ...readAction, id: uuid }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true, status: 200, steps: [] }),
        });

      const result = await callTool({ action: uuid });

      expect(mockFetchClient).toHaveBeenNthCalledWith(1, `${BASE_URL}/${uuid}`);
      expect(result.isError).toBeFalsy();
    });

    it('falls back to slug search when a uuid-shaped slug 404s by id', async () => {
      const uuidShapedSlug = '3f7b6f0e-6a54-4d2f-9b7e-2d1a4c8e5b90';
      mockFetchClient
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [{ ...readAction, slug: uuidShapedSlug }],
            total: 1,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true, status: 200, steps: [] }),
        });

      const result = await callTool({ action: uuidShapedSlug });

      expect(mockFetchClient).toHaveBeenNthCalledWith(
        1,
        `${BASE_URL}/${uuidShapedSlug}`,
      );
      expect(mockFetchClient).toHaveBeenNthCalledWith(
        2,
        `${BASE_URL}/?search=${uuidShapedSlug}&offset=0`,
      );
      expect(result.isError).toBeFalsy();
    });

    it('reports a clear not-found error', async () => {
      mockFetchClient.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      });

      const result = await callTool({ action: 'missing-action' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        "Action 'missing-action' not found",
      );
    });

    it('surfaces a failed execute envelope as isError', async () => {
      mockFetchClient
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [readAction] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ok: false,
            status: 500,
            error: { message: 'upstream broke' },
            steps: [],
          }),
        });

      const result = await callTool({ action: 'list-repos' });

      expect(result.isError).toBe(true);
    });

    it('returns an error on lookup failure', async () => {
      mockFetchClient.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await callTool({ action: 'list-repos' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('500');
    });
  });
});
