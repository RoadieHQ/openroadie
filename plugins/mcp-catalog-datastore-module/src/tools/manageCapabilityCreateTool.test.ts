import { constructManageCapabilityCreateTool } from './manageCapabilityCreateTool';

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

const CAPABILITIES_URL = 'http://localhost:7007/api/capabilities';

beforeEach(() => {
  vi.restoreAllMocks();
  mockDiscovery.getBaseUrl.mockResolvedValue(CAPABILITIES_URL);
});

const PARAMS = {
  name: 'Deploy Service',
  description: 'Deploys a service',
  instructions: 'Call @action:deploy',
};

/** Builds the tool and invokes it with a stubbed fetch client. */
async function invoke(
  mockFetchClient: ReturnType<typeof vi.fn>,
  params: Record<string, unknown> = PARAMS,
) {
  const tool = await constructManageCapabilityCreateTool(
    mockDiscovery as any,
    mockLogger as any,
  );
  const cb = tool.cb({
    prePermissionedFetchClient: mockFetchClient,
    discovery: mockDiscovery,
  } as any);
  return cb(params as any, {} as any);
}

/**
 * The text of the first content block. MCP results are a union of block kinds
 * and only the text one carries `text`, so narrow rather than reach through.
 */
function firstText(result: Awaited<ReturnType<typeof invoke>>) {
  const [block] = result.content ?? [];
  if (block?.type !== 'text') {
    throw new Error(`expected a text content block, got ${block?.type}`);
  }
  return block.text;
}

/** The method + URL of the write call (POST or PUT). */
function writeCall(mockFetchClient: ReturnType<typeof vi.fn>) {
  const call = mockFetchClient.mock.calls.find(
    ([, options]) =>
      options &&
      (options.method === 'POST' ||
        options.method === 'PUT' ||
        options.method === 'PATCH'),
  );
  return call ? { url: call[0], ...call[1] } : undefined;
}

const written = (mockFetchClient: ReturnType<typeof vi.fn>) =>
  JSON.parse(writeCall(mockFetchClient)!.body);

const created = (id: string, slug: string) => ({
  ok: true,
  json: async () => ({
    id,
    slug,
    name: PARAMS.name,
    description: PARAMS.description,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }),
});

describe('manage_capability_create', () => {
  it('creates when no capability matches the derived slug', async () => {
    const fetchClient = vi.fn(async (_url: string, options?: any) => {
      if (!options) return { ok: false, status: 404, statusText: 'Not Found' };
      return created('cap-1', 'deploy-service');
    });

    const result = await invoke(fetchClient);

    expect(fetchClient).toHaveBeenCalledWith(
      `${CAPABILITIES_URL}/deploy-service`,
    );
    expect(writeCall(fetchClient)).toMatchObject({
      url: CAPABILITIES_URL,
      method: 'POST',
    });
    expect(result.structuredContent).toMatchObject({ id: 'cap-1' });
  });

  it('updates the capability whose slug already exists', async () => {
    const fetchClient = vi.fn(async (_url: string, options?: any) => {
      if (!options) return { ok: true, json: async () => ({ id: 'cap-9' }) };
      return created('cap-9', 'deploy-service');
    });

    await invoke(fetchClient);

    expect(writeCall(fetchClient)).toMatchObject({
      url: `${CAPABILITIES_URL}/cap-9`,
      method: 'PATCH',
    });
  });

  it('resolves an existing capability without listing', async () => {
    const fetchClient = vi.fn(async (_url: string, options?: any) => {
      if (!options) return { ok: true, json: async () => ({ id: 'cap-51' }) };
      return created('cap-51', 'deploy-service');
    });

    await invoke(fetchClient);

    const listCalls = fetchClient.mock.calls.filter(
      ([url]) => url === CAPABILITIES_URL || url === `${CAPABILITIES_URL}/`,
    );
    expect(listCalls).toHaveLength(0);
  });

  it('revises by slug even when the name changed', async () => {
    const fetchClient = vi.fn(async (_url: string, options?: any) => {
      if (!options) return { ok: true, json: async () => ({ id: 'cap-2' }) };
      return created('cap-2', 'deploy-service');
    });

    await invoke(fetchClient, {
      ...PARAMS,
      name: 'Deploy A Service, Renamed',
      slug: 'deploy-service',
    });

    expect(fetchClient).toHaveBeenCalledWith(
      `${CAPABILITIES_URL}/deploy-service`,
    );
    expect(writeCall(fetchClient)).toMatchObject({
      url: `${CAPABILITIES_URL}/cap-2`,
      method: 'PATCH',
    });
    expect(written(fetchClient)).toMatchObject({
      name: 'Deploy A Service, Renamed',
      slug: 'deploy-service',
    });
  });

  it('updates directly from an explicit id without a lookup', async () => {
    const fetchClient = vi.fn(async () => created('cap-3', 'deploy-service'));

    await invoke(fetchClient, { ...PARAMS, id: 'cap-3' });

    expect(fetchClient).toHaveBeenCalledTimes(1);
    expect(writeCall(fetchClient)).toMatchObject({
      url: `${CAPABILITIES_URL}/cap-3`,
      method: 'PATCH',
    });
  });

  it('creates when the caller cannot read capabilities (403 lookup)', async () => {
    const fetchClient = vi.fn(async (_url: string, options?: any) => {
      if (!options) return { ok: false, status: 403, statusText: 'Forbidden' };
      return created('cap-4', 'deploy-service');
    });

    await invoke(fetchClient);

    expect(writeCall(fetchClient)).toMatchObject({ method: 'POST' });
  });

  it('tells the caller how to recover when an unreadable capability collides', async () => {
    const fetchClient = vi.fn(async (_url: string, options?: any) => {
      if (!options) return { ok: false, status: 403, statusText: 'Forbidden' };
      return {
        ok: false,
        status: 409,
        statusText: 'Conflict',
        text: async () => 'already exists',
      };
    });

    const result = await invoke(fetchClient);

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('explore_capability_get');
  });

  it('surfaces an unexpected lookup failure instead of creating', async () => {
    const fetchClient = vi.fn(async (_url: string, options?: any) => {
      if (!options) {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'boom',
        };
      }
      return created('cap-5', 'deploy-service');
    });

    const result = await invoke(fetchClient);

    expect(result.isError).toBe(true);
    expect(writeCall(fetchClient)).toBeUndefined();
  });

  it('omits slug on create so the backend derives it', async () => {
    const fetchClient = vi.fn(async (_url: string, options?: any) => {
      if (!options) return { ok: false, status: 404, statusText: 'Not Found' };
      return created('cap-6', 'deploy-service');
    });

    await invoke(fetchClient);

    expect(written(fetchClient)).not.toHaveProperty('slug');
  });
});

describe('manage_capability_create instructions', () => {
  it('documents the reference grammar and the replay-and-revise loop', async () => {
    const tool = await constructManageCapabilityCreateTool(
      mockDiscovery as any,
      mockLogger as any,
    );
    const { description } = tool.config;

    for (const type of ['@datasource:', '@action:', '@context-group:']) {
      expect(description).toContain(type);
    }
    expect(description).toContain('explore_capability_get');
    expect(description).toContain('resolved: false');
  });
});
