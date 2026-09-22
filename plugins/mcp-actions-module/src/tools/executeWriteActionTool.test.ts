import { constructExecuteWriteActionTool } from './executeWriteActionTool';

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

describe('constructExecuteWriteActionTool', () => {
  it('creates the tool with write annotations', async () => {
    const tool = await constructExecuteWriteActionTool(
      mockDiscovery as any,
      mockLogger as any,
    );

    expect(tool.name).toBe('actions_execute_write');
    expect(tool.config.annotations).toEqual({
      title: 'Execute a write action',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
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
      const tool = await constructExecuteWriteActionTool(
        mockDiscovery as any,
        mockLogger as any,
      );
      mockFetchClient = vi.fn();
      callTool = tool.cb({
        prePermissionedFetchClient: mockFetchClient,
        discovery: mockDiscovery,
      } as any) as any;
    });

    it('executes a write action resolved by slug', async () => {
      mockFetchClient
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [writeAction] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            ok: true,
            status: 201,
            data: { id: 'repo-1' },
            steps: [],
          }),
        });

      const result = await callTool({
        action: 'create-repo',
        inputs: { name: 'demo' },
      });

      expect(mockFetchClient).toHaveBeenNthCalledWith(
        1,
        `${BASE_URL}/?search=create-repo&offset=0`,
      );
      expect(mockFetchClient).toHaveBeenNthCalledWith(
        2,
        `${BASE_URL}/create-repo/execute`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            inputs: { name: 'demo' },
            requireEnabled: true,
          }),
        }),
      );
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        ok: true,
        status: 201,
        data: { id: 'repo-1' },
        steps: [],
      });
    });

    it('refuses a read action without executing it, pointing at actions_execute_read', async () => {
      mockFetchClient.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [readAction] }),
      });

      const result = await callTool({ action: 'list-repos' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('read-only action');
      expect(result.content[0].text).toContain('actions_execute_read');
      expect(mockFetchClient).toHaveBeenCalledTimes(1);
    });

    it('derives write mode from step methods when the backend omits effectiveMode', async () => {
      mockFetchClient
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [
              {
                ...writeAction,
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

      const result = await callTool({ action: 'create-repo' });

      expect(result.isError).toBeFalsy();
      expect(mockFetchClient).toHaveBeenCalledTimes(2);
    });

    it('resolves uuid references via GET /:id', async () => {
      const uuid = '3f7b6f0e-6a54-4d2f-9b7e-2d1a4c8e5b90';
      mockFetchClient
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ...writeAction, id: uuid }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true, status: 200, steps: [] }),
        });

      const result = await callTool({ action: uuid });

      expect(mockFetchClient).toHaveBeenNthCalledWith(1, `${BASE_URL}/${uuid}`);
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
          json: async () => ({ items: [writeAction] }),
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

      const result = await callTool({ action: 'create-repo' });

      expect(result.isError).toBe(true);
    });

    it('returns an error on lookup failure', async () => {
      mockFetchClient.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await callTool({ action: 'create-repo' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('500');
    });
  });
});
