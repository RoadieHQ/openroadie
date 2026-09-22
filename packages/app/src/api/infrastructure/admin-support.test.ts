import type { AuthSession } from './auth';
import type { AppConfig } from './config';
import { resolveAdminConfig } from './admin-support';

const baseConfig: AppConfig = {
  app: {
    title: 'Catalog Builder',
    baseUrl: 'http://localhost:3333',
  },
  backend: {
    baseUrl: 'http://localhost:7008',
    headers: {
      'x-scope': 'development',
    },
  },
};

describe('resolveAdminConfig', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enables admin when the backend exposes the admin api', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveAdminConfig(baseConfig);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:7008/api/secrets-settings/storage-mode',
      {
        credentials: 'include',
        headers: {
          'x-scope': 'development',
        },
      },
    );
    expect(resolved.features?.admin).toBe(true);
  });

  it('disables admin when the backend does not expose the admin api', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 404 });
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveAdminConfig(baseConfig);

    expect(resolved.features?.admin).toBe(false);
  });

  it('uses the auth session token when one is available', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 403 });
    vi.stubGlobal('fetch', fetchMock);
    const auth = {
      getAccessToken: vi.fn().mockResolvedValue('test-token'),
    } as unknown as AuthSession;

    const resolved = await resolveAdminConfig(baseConfig, auth);

    expect(auth.getAccessToken).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:7008/api/secrets-settings/storage-mode',
      {
        headers: {
          'x-scope': 'development',
          Authorization: 'Bearer test-token',
        },
      },
    );
    expect(resolved.features?.admin).toBe(true);
  });

  it('keeps an explicit admin setting without probing the backend', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const resolved = await resolveAdminConfig({
      ...baseConfig,
      features: { admin: false },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(resolved.features?.admin).toBe(false);
  });
});
