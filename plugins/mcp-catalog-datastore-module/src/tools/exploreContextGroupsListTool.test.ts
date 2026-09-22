import { constructExploreContextGroupsListTool } from './exploreContextGroupsListTool';

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

/** Route the mock fetch by URL: groups endpoint vs views endpoint. */
function routeFetch(
  mockFetchClient: ReturnType<typeof vi.fn>,
  responses: { groups: unknown; views?: unknown },
) {
  mockFetchClient.mockImplementation(async (url: string) => {
    if (url.endsWith('/views')) {
      if (responses.views === undefined) {
        return { ok: false, status: 404, statusText: 'Not Found' };
      }
      return { ok: true, json: async () => responses.views };
    }
    return { ok: true, json: async () => responses.groups };
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockDiscovery.getBaseUrl.mockResolvedValue(BASE_URL);
});

describe('constructExploreContextGroupsListTool', () => {
  it('creates tool with correct name and family scope', async () => {
    const tool = await constructExploreContextGroupsListTool(
      mockDiscovery as any,
      mockLogger as any,
    );
    expect(tool.name).toBe('explore_context_groups_list');
    expect(tool.familyScope).toBe(true);
    expect(tool.config.annotations?.readOnlyHint).toBe(true);
  });

  describe('callback', () => {
    let callTool: (params: { rule: string }) => Promise<any>;
    let mockFetchClient: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const tool = await constructExploreContextGroupsListTool(
        mockDiscovery as any,
        mockLogger as any,
      );
      mockFetchClient = vi.fn();
      callTool = tool.cb({
        prePermissionedFetchClient: mockFetchClient,
        discovery: mockDiscovery,
      } as any) as any;
    });

    it('calls the groups and views endpoints with the rule ref encoded', async () => {
      routeFetch(mockFetchClient, {
        groups: { groups: [], totalGroups: 0 },
        views: { items: [] },
      });

      await callTool({ rule: 'repositories' });

      expect(mockFetchClient).toHaveBeenCalledWith(
        `${BASE_URL}/context-groups/rules/repositories/groups`,
      );
      expect(mockFetchClient).toHaveBeenCalledWith(
        `${BASE_URL}/context-groups/rules/repositories/views`,
      );
    });

    it('maps groups to lightweight groupId + member labels', async () => {
      routeFetch(mockFetchClient, {
        groups: {
          totalGroups: 1,
          groups: [
            {
              id: 'group-uuid-1',
              name: 'Repo A',
              members: [
                {
                  datasourceId: 'ds-1',
                  objectId: 'obj-1',
                  displayName: 'Repo A',
                  object: { name: 'Repo A', secret: 'x' },
                },
                {
                  datasourceId: 'ds-2',
                  objectId: 'obj-2',
                  displayName: 'Repo A (mirror)',
                  object: {},
                },
              ],
            },
          ],
        },
        views: { items: [] },
      });

      const result = await callTool({ rule: 'repositories' });

      expect(result.structuredContent).toEqual({
        rule: 'repositories',
        totalGroups: 1,
        groups: [
          {
            groupId: 'group-uuid-1',
            name: 'Repo A',
            members: [
              {
                datasourceId: 'ds-1',
                objectId: 'obj-1',
                displayName: 'Repo A',
              },
              {
                datasourceId: 'ds-2',
                objectId: 'obj-2',
                displayName: 'Repo A (mirror)',
              },
            ],
          },
        ],
        views: [],
      });
      // full object data is not leaked into the summary
      expect(result.structuredContent.groups[0].members[0]).not.toHaveProperty(
        'object',
      );
    });

    it('advertises the rule views and how to use them', async () => {
      routeFetch(mockFetchClient, {
        groups: {
          totalGroups: 1,
          groups: [{ id: 'g-1', name: 'Group', members: [] }],
        },
        views: {
          items: [
            {
              id: 'p-1',
              name: 'default',
              description: 'Shows everything.',
              isDefault: true,
              template: 'not leaked',
            },
            {
              id: 'p-2',
              name: 'activity',
              description: 'PR counts',
              isDefault: false,
              template: 'not leaked',
            },
          ],
        },
      });

      const result = await callTool({ rule: 'people' });

      expect(result.structuredContent.views).toEqual([
        { name: 'default', description: 'Shows everything.', isDefault: true },
        { name: 'activity', description: 'PR counts', isDefault: false },
      ]);
      expect(result.content[0].text).toContain('"default" (default)');
      expect(result.content[0].text).toContain('"activity" — PR counts');
      expect(result.content[0].text).toContain('explore_context_bundle_get');
    });

    it('degrades to an empty views list when the endpoint fails', async () => {
      routeFetch(mockFetchClient, {
        groups: { totalGroups: 0, groups: [] },
        // no views response → 404
      });

      const result = await callTool({ rule: 'repositories' });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent.views).toEqual([]);
    });

    it('normalizes a groups 404 into an empty, non-error result', async () => {
      mockFetchClient.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await callTool({ rule: 'nope' });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({
        rule: 'nope',
        totalGroups: 0,
        groups: [],
        views: [],
      });
    });

    it('errors on a non-404 failure', async () => {
      mockFetchClient.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
      });

      const result = await callTool({ rule: 'boom' });

      expect(result.isError).toBe(true);
    });
  });
});
