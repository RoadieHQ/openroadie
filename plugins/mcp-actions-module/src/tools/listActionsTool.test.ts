import { constructListActionsTool } from './listActionsTool';

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

beforeEach(() => {
  vi.restoreAllMocks();
  mockDiscovery.getBaseUrl.mockResolvedValue(BASE_URL);
});

describe('constructListActionsTool', () => {
  it('creates the tool with read-only annotations', async () => {
    const tool = await constructListActionsTool(
      mockDiscovery as any,
      mockLogger as any,
    );

    expect(tool.name).toBe('actions_list');
    expect(tool.config.annotations).toEqual({
      title: 'List runnable actions',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  describe('callback', () => {
    let callTool: (params: { search?: string }) => Promise<any>;
    let mockFetchClient: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const tool = await constructListActionsTool(
        mockDiscovery as any,
        mockLogger as any,
      );
      mockFetchClient = vi.fn();
      callTool = tool.cb({
        prePermissionedFetchClient: mockFetchClient,
        discovery: mockDiscovery,
      } as any) as any;
    });

    it('includes each action effective mode in items and summary', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'a1',
              name: 'List repos',
              slug: 'list-repos',
              description: 'Lists repos',
              enabled: true,
              mode: null,
              effectiveMode: 'read',
              steps: [{ request: { method: 'GET' } }],
              inputSchema: { type: 'object' },
            },
            {
              id: 'a2',
              name: 'Create repo',
              slug: 'create-repo',
              description: 'Creates a repo',
              enabled: true,
              mode: null,
              effectiveMode: 'write',
              steps: [{ request: { method: 'POST' } }],
              inputSchema: { type: 'object' },
            },
          ],
        }),
      });

      const result = await callTool({});

      expect(result.structuredContent.items).toEqual([
        expect.objectContaining({ slug: 'list-repos', mode: 'read' }),
        expect.objectContaining({ slug: 'create-repo', mode: 'write' }),
      ]);
      expect(result.content[0].text).toContain('GET, read');
      expect(result.content[0].text).toContain('POST, write');
    });

    it('honours a manual override and derives when the backend omits mode fields', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'a1',
              name: 'Overridden',
              slug: 'overridden',
              description: '',
              enabled: true,
              mode: 'write',
              steps: [{ request: { method: 'GET' } }],
            },
            {
              id: 'a2',
              name: 'Derived',
              slug: 'derived',
              description: '',
              enabled: true,
              steps: [{ request: { method: 'GET' } }],
            },
          ],
        }),
      });

      const result = await callTool({});

      expect(result.structuredContent.items).toEqual([
        expect.objectContaining({ slug: 'overridden', mode: 'write' }),
        expect.objectContaining({ slug: 'derived', mode: 'read' }),
      ]);
    });

    it('filters out disabled actions', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              id: 'a1',
              name: 'Disabled',
              slug: 'disabled',
              description: '',
              enabled: false,
              steps: [{ request: { method: 'GET' } }],
            },
          ],
        }),
      });

      const result = await callTool({});

      expect(result.structuredContent.items).toEqual([]);
      expect(result.content[0].text).toContain('No actions available');
    });

    it('returns an error for a non-ok response', async () => {
      mockFetchClient.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await callTool({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('500');
    });
  });
});
