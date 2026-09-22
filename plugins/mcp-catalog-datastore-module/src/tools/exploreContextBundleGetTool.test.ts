import { constructExploreContextBundleGetTool } from './exploreContextBundleGetTool';

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

const BASE_URL = 'http://localhost:7007/api/catalog-datastore';
const GROUP_ID = '11111111-1111-4111-8111-111111111111';

const renderedBundle = {
  groupId: GROUP_ID,
  ruleId: '22222222-2222-4222-8222-222222222222',
  ruleName: 'Employee',
  group: { id: GROUP_ID, name: 'Brian Fletcher' },
  rule: {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Employee',
    slug: 'employee',
    description: null,
  },
  view: { name: 'default', description: 'Shows everything.' },
  availableViews: [
    { name: 'default', description: 'Shows everything.', isDefault: true },
    { name: 'activity', description: 'PR counts', isDefault: false },
  ],
  rendered: '# Brian Fletcher\n\nname: Brian Fletcher',
};

beforeEach(() => {
  vi.restoreAllMocks();
  mockDiscovery.getBaseUrl.mockResolvedValue(BASE_URL);
});

describe('constructExploreContextBundleGetTool', () => {
  describe('callback', () => {
    let callTool: (params: {
      groupId: string;
      view?: string;
      memberLimit?: number;
    }) => Promise<any>;
    let mockFetchClient: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const tool = await constructExploreContextBundleGetTool(
        mockDiscovery as any,
        mockLogger as any,
      );
      mockFetchClient = vi.fn();
      callTool = tool.cb({
        prePermissionedFetchClient: mockFetchClient,
        discovery: mockDiscovery,
      } as any) as any;
    });

    it('short-circuits a non-UUID (slug) groupId with an actionable error', async () => {
      const result = await callTool({ groupId: 'repositories' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('explore_context_groups_list');
      expect(result.content[0].text).toContain('repositories');
      // never hits the backend
      expect(mockFetchClient).not.toHaveBeenCalled();
    });

    it('requests the default view when none is given', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => renderedBundle,
      });

      await callTool({ groupId: GROUP_ID });

      expect(mockFetchClient).toHaveBeenCalledWith(
        `${BASE_URL}/context-groups/groups/${GROUP_ID}/bundle?view=&memberLimit=48`,
      );
    });

    it('requests a named view', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          ...renderedBundle,
          view: { name: 'activity', description: 'PR counts' },
        }),
      });

      await callTool({ groupId: GROUP_ID, view: 'activity' });

      expect(mockFetchClient).toHaveBeenCalledWith(
        `${BASE_URL}/context-groups/groups/${GROUP_ID}/bundle?view=activity&memberLimit=48`,
      );
    });

    it('returns the rendered document as the text content, not raw members', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => renderedBundle,
      });

      const result = await callTool({ groupId: GROUP_ID });

      expect(result.content[0].text).toContain('# Brian Fletcher');
      expect(result.content[0].text).toContain(
        'rendered through the "default" view',
      );
      // The old structured payload is gone from the text channel.
      expect(result.content[0].text).not.toContain('"members"');
      expect(result.structuredContent).toEqual(renderedBundle);
    });

    it('advertises the other available views with a follow-up hint', async () => {
      mockFetchClient.mockResolvedValue({
        ok: true,
        json: async () => renderedBundle,
      });

      const result = await callTool({ groupId: GROUP_ID });

      expect(result.content[0].text).toContain('"activity" (PR counts)');
      expect(result.content[0].text).toContain('view: "<name>"');
    });

    it('maps an unknown view 404 to an actionable error', async () => {
      mockFetchClient.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'View "nope" not found' }),
      });

      const result = await callTool({ groupId: GROUP_ID, view: 'nope' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('View "nope"');
      expect(result.content[0].text).toContain('availableViews');
    });

    it('maps an unknown group 404 to a not-found error', async () => {
      mockFetchClient.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Context group not found' }),
      });

      const result = await callTool({ groupId: GROUP_ID });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Context bundle not found');
    });
  });
});
