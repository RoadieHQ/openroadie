import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mocked,
} from 'vitest';

import * as crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { createGithubWebhookHandler } from './githubAppWebhook';
import { GithubAppDao } from '../../database/GithubAppDao';
import { GithubAppInstallationDao } from '../../database/GithubAppInstallationDao';
import { GithubAppInstallRequestDao } from '../../database/GithubAppInstallRequestDao';
import { WebhookDeliveryDao } from '../../database/WebhookDeliveryDao';
import { GithubAppService } from '../../service/GithubAppService';
import type { SecretStoreService } from '@roadiehq/secrets-node';

let failingSecretRef: string | undefined;

const envBackedSecretStore: SecretStoreService = {
  resolver: () => ({
    async resolve(refs) {
      if (failingSecretRef && refs.includes(failingSecretRef)) {
        throw new Error('secret unavailable');
      }
      const out: Record<string, string> = {};
      for (const ref of refs) {
        const v = process.env[ref];
        if (v !== undefined) {
          out[ref] = v;
        }
      }
      return out;
    },
  }),
  writer: () => ({
    readOnly: true,
    async put() {
      throw new Error('read-only');
    },
    async delete() {
      throw new Error('read-only');
    },
    async listRefs() {
      return [];
    },
    async exists(ref) {
      return process.env[ref] !== undefined;
    },
  }),
  info: () => ({ mode: 'env', readOnly: true }),
};

const voidLogger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  child: () => voidLogger,
} as any;

vi.mock('undici', () => ({
  fetch: vi.fn(),
}));

function signPayload(payload: string, secret: string): string {
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return `sha256=${hmac}`;
}

describe('createGithubWebhookHandler', () => {
  const WEBHOOK_SECRET = 'whsec_test_secret_123';

  let app: express.Express;
  let mockGithubAppDao: Mocked<GithubAppDao>;
  let mockInstallationDao: Mocked<GithubAppInstallationDao>;
  let mockInstallRequestDao: Mocked<GithubAppInstallRequestDao>;
  let mockWebhookDeliveryDao: Mocked<WebhookDeliveryDao>;
  let mockGithubAppService: Mocked<Pick<GithubAppService, 'generateAppJWT'>>;

  beforeEach(() => {
    process.env.GH_APP_WEBHOOK_SECRET = WEBHOOK_SECRET;

    mockGithubAppDao = {
      listAppsByAppId: vi.fn().mockResolvedValue([
        {
          id: 'app-uuid',
          appId: '12345',
          host: 'github.com',
          slug: 'my-test-app',
          webhookSecretRef: 'GH_APP_WEBHOOK_SECRET',
          status: 'active',
        },
      ]),
      listAppsWithWorkspaces: vi.fn().mockResolvedValue([
        {
          app: {
            id: 'app-uuid',
            appId: '12345',
            host: 'github.com',
            slug: 'my-test-app',
            webhookSecretRef: 'GH_APP_WEBHOOK_SECRET',
            status: 'active',
          },
          workspaceId: undefined,
        },
      ]),
      getByAppId: vi.fn().mockResolvedValue({
        id: 'app-uuid',
        appId: '12345',
        host: 'github.com',
        slug: 'my-test-app',
        webhookSecretRef: 'GH_APP_WEBHOOK_SECRET',
        status: 'active',
      }),
    } as unknown as Mocked<GithubAppDao>;

    mockInstallationDao = {
      upsert: vi.fn().mockResolvedValue({
        id: 'inst-uuid',
        appId: '12345',
        host: 'github.com',
        installationId: 999,
      }),
      deleteByAppAndInstallationId: vi.fn().mockResolvedValue({
        orgLogin: 'acme-org',
      }),
    } as unknown as Mocked<GithubAppInstallationDao>;

    mockInstallRequestDao = {
      findByAppAndHost: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<GithubAppInstallRequestDao>;

    mockGithubAppService = {
      generateAppJWT: vi.fn().mockResolvedValue(undefined),
    } as unknown as Mocked<Pick<GithubAppService, 'generateAppJWT'>>;

    mockWebhookDeliveryDao = {
      markSeen: vi.fn().mockResolvedValue(true),
    } as unknown as Mocked<WebhookDeliveryDao>;

    const handler = createGithubWebhookHandler({
      logger: voidLogger,
      githubAppDao: mockGithubAppDao,
      githubAppInstallationDao: mockInstallationDao,
      githubAppInstallRequestDao: mockInstallRequestDao,
      webhookDeliveryDao: mockWebhookDeliveryDao,
      githubAppService: mockGithubAppService as unknown as GithubAppService,
      secretStore: envBackedSecretStore,
    });

    app = express();
    app.post(
      '/github-app/webhook',
      express.raw({ type: 'application/json' }),
      handler,
    );
  });

  afterEach(() => {
    delete process.env.GH_APP_WEBHOOK_SECRET;
    delete process.env.GHES_APP_WEBHOOK_SECRET;
    failingSecretRef = undefined;
    vi.resetAllMocks();
  });

  function sendWebhook() {
    return request(app)
      .post('/github-app/webhook')
      .set('Content-Type', 'application/json');
  }

  it('should delete the installation on a valid uninstall webhook', async () => {
    const payload = JSON.stringify({
      action: 'deleted',
      installation: {
        id: 999,
        app_id: 12345,
        account: { login: 'acme-org' },
      },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, WEBHOOK_SECRET))
      .set('X-GitHub-Delivery', 'delivery-uuid-1')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true });
    expect(mockWebhookDeliveryDao.markSeen).toHaveBeenCalledWith(
      'github',
      'delivery-uuid-1',
    );
    expect(
      mockInstallationDao.deleteByAppAndInstallationId,
    ).toHaveBeenCalledWith('12345', 999, 'github.com');
  });

  it('should return 401 for missing signature header', async () => {
    const payload = JSON.stringify({
      action: 'deleted',
      installation: { id: 999, app_id: 12345 },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Missing X-Hub-Signature-256 header');
  });

  it('should return 401 for an invalid signature', async () => {
    const payload = JSON.stringify({
      action: 'deleted',
      installation: { id: 999, app_id: 12345 },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set(
        'X-Hub-Signature-256',
        'sha256=0000000000000000000000000000000000000000000000000000000000000000',
      )
      .set('X-GitHub-Delivery', 'delivery-uuid-2')
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid webhook signature');
  });

  it('should ignore non-installation events with 200', async () => {
    const payload = JSON.stringify({
      action: 'completed',
      check_run: { id: 1 },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'check_run')
      .set('X-Hub-Signature-256', signPayload(payload, WEBHOOK_SECRET))
      .set('X-GitHub-Delivery', 'delivery-uuid-3')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true, ignored: true });
    expect(
      mockInstallationDao.deleteByAppAndInstallationId,
    ).not.toHaveBeenCalled();
    expect(mockGithubAppDao.listAppsByAppId).not.toHaveBeenCalled();
    expect(mockGithubAppDao.listAppsWithWorkspaces).not.toHaveBeenCalled();
  });

  it('should reject installation events without an app id', async () => {
    const payload = JSON.stringify({
      action: 'deleted',
      installation: { id: 999 },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, WEBHOOK_SECRET))
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Missing installation app_id');
    expect(mockGithubAppDao.listAppsByAppId).not.toHaveBeenCalled();
    expect(mockGithubAppDao.listAppsWithWorkspaces).not.toHaveBeenCalled();
  });

  it('should ignore installation.created when no pending request exists', async () => {
    mockInstallRequestDao.findByAppAndHost.mockResolvedValueOnce([]);

    const payload = JSON.stringify({
      action: 'created',
      installation: {
        id: 999,
        app_id: 12345,
        account: { login: 'acme-org' },
      },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, WEBHOOK_SECRET))
      .set('X-GitHub-Delivery', 'delivery-uuid-4')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true, ignored: true });
    expect(mockInstallationDao.upsert).not.toHaveBeenCalled();
  });

  it('should fulfill a pending request on installation.created', async () => {
    mockInstallRequestDao.findByAppAndHost.mockResolvedValueOnce([
      {
        id: 'req-1',
        appId: '12345',
        host: 'github.com',
        orgLogin: 'acme-org',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ]);

    const payload = JSON.stringify({
      action: 'created',
      installation: {
        id: 999,
        app_id: 12345,
        account: { login: 'acme-org' },
      },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, WEBHOOK_SECRET))
      .set('X-GitHub-Delivery', 'delivery-created-1')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true });
    expect(mockInstallationDao.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: '12345',
        host: 'github.com',
        installationId: 999,
        orgLogin: 'acme-org',
      }),
    );
    expect(mockInstallRequestDao.delete).toHaveBeenCalledWith('req-1');
  });

  it('should ignore installation.created when org login does not match any pending request', async () => {
    mockInstallRequestDao.findByAppAndHost.mockResolvedValueOnce([
      {
        id: 'req-1',
        appId: '12345',
        host: 'github.com',
        orgLogin: 'acme-org',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ]);

    const payload = JSON.stringify({
      action: 'created',
      installation: {
        id: 999,
        app_id: 12345,
        account: { login: 'globex-org' },
      },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, WEBHOOK_SECRET))
      .set('X-GitHub-Delivery', 'delivery-created-mismatch')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true, ignored: true });
    expect(mockInstallationDao.upsert).not.toHaveBeenCalled();
    expect(mockInstallRequestDao.delete).not.toHaveBeenCalled();
  });

  it('should ignore installation.created without org login when multiple pending requests exist', async () => {
    mockInstallRequestDao.findByAppAndHost.mockResolvedValueOnce([
      {
        id: 'req-1',
        appId: '12345',
        host: 'github.com',
        orgLogin: 'acme-org',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
      {
        id: 'req-2',
        appId: '12345',
        host: 'github.com',
        orgLogin: 'globex-org',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ]);

    const payload = JSON.stringify({
      action: 'created',
      installation: {
        id: 999,
        app_id: 12345,
      },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, WEBHOOK_SECRET))
      .set('X-GitHub-Delivery', 'delivery-created-no-org')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true, ignored: true });
    expect(mockInstallationDao.upsert).not.toHaveBeenCalled();
    expect(mockInstallRequestDao.delete).not.toHaveBeenCalled();
  });

  it('should ignore installation.created without org login when a single pending request exists', async () => {
    mockInstallRequestDao.findByAppAndHost.mockResolvedValueOnce([
      {
        id: 'req-1',
        appId: '12345',
        host: 'github.com',
        orgLogin: 'acme-org',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ]);

    const payload = JSON.stringify({
      action: 'created',
      installation: {
        id: 999,
        app_id: 12345,
      },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, WEBHOOK_SECRET))
      .set('X-GitHub-Delivery', 'delivery-created-no-org-single')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true, ignored: true });
    expect(mockInstallationDao.upsert).not.toHaveBeenCalled();
    expect(mockInstallRequestDao.delete).not.toHaveBeenCalled();
  });

  it('should ignore non-created/deleted installation actions', async () => {
    const payload = JSON.stringify({
      action: 'suspend',
      installation: { id: 999, app_id: 12345 },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, WEBHOOK_SECRET))
      .set('X-GitHub-Delivery', 'delivery-uuid-suspend')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true, ignored: true });
    expect(
      mockInstallationDao.deleteByAppAndInstallationId,
    ).not.toHaveBeenCalled();
    expect(mockInstallationDao.upsert).not.toHaveBeenCalled();
  });

  it('should reject uninstall for an unknown app', async () => {
    mockGithubAppDao.listAppsByAppId.mockResolvedValueOnce([]);

    const payload = JSON.stringify({
      action: 'deleted',
      installation: {
        id: 999,
        app_id: 99999,
        account: { login: 'unknown-org' },
      },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, WEBHOOK_SECRET))
      .set('X-GitHub-Delivery', 'delivery-uuid-5')
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid webhook signature');
    expect(
      mockInstallationDao.deleteByAppAndInstallationId,
    ).not.toHaveBeenCalled();
  });

  it('should handle uninstall when no matching installation record exists', async () => {
    mockInstallationDao.deleteByAppAndInstallationId.mockResolvedValueOnce(
      undefined,
    );

    const payload = JSON.stringify({
      action: 'deleted',
      installation: {
        id: 888,
        app_id: 12345,
        account: { login: 'other-org' },
      },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, WEBHOOK_SECRET))
      .set('X-GitHub-Delivery', 'delivery-uuid-6')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true });
    expect(
      mockInstallationDao.deleteByAppAndInstallationId,
    ).toHaveBeenCalledWith('12345', 888, 'github.com');
  });

  it('resolves request scope from (app_id, host, installation_id) without any scope hint in the webhook payload — shared-scope contract', async () => {
    mockInstallationDao.deleteByAppAndInstallationId.mockResolvedValueOnce({
      orgLogin: 'globex-org',
    });

    const payload = JSON.stringify({
      action: 'deleted',
      installation: {
        id: 555,
        app_id: 12345,
        account: { login: 'globex-org' },
      },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, WEBHOOK_SECRET))
      .set('X-GitHub-Delivery', 'delivery-shared-scope')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true });

    expect(
      mockInstallationDao.deleteByAppAndInstallationId,
    ).toHaveBeenCalledWith('12345', 555, 'github.com');

    expect(
      mockInstallationDao.deleteByAppAndInstallationId,
    ).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.stringContaining('globex'),
    );
  });

  it('should reject a replayed webhook delivery', async () => {
    mockWebhookDeliveryDao.markSeen.mockResolvedValueOnce(false);

    const payload = JSON.stringify({
      action: 'deleted',
      installation: {
        id: 999,
        app_id: 12345,
        account: { login: 'acme-org' },
      },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, WEBHOOK_SECRET))
      .set('X-GitHub-Delivery', 'delivery-uuid-replay')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true, replayed: true });
    expect(
      mockInstallationDao.deleteByAppAndInstallationId,
    ).not.toHaveBeenCalled();
    expect(mockInstallationDao.upsert).not.toHaveBeenCalled();
  });

  it('should handle enterprise host normalization', async () => {
    mockGithubAppDao.listAppsByAppId.mockResolvedValueOnce([
      {
        id: 'app-uuid',
        appId: '12345',
        host: 'https://ghe.example.com',
        slug: 'my-test-app',
        webhookSecretRef: 'GH_APP_WEBHOOK_SECRET',
        status: 'active',
      } as any,
    ]);

    const payload = JSON.stringify({
      action: 'deleted',
      installation: {
        id: 777,
        app_id: 12345,
        account: { login: 'enterprise-org' },
      },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, WEBHOOK_SECRET))
      .set('X-GitHub-Delivery', 'delivery-uuid-7')
      .send(payload);

    expect(res.status).toBe(200);
    expect(
      mockInstallationDao.deleteByAppAndInstallationId,
    ).toHaveBeenCalledWith('12345', 777, 'ghe.example.com');
  });

  it('verifies the matching host when app ids overlap', async () => {
    process.env.GHES_APP_WEBHOOK_SECRET = 'enterprise-secret';
    const timestamps = {
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
    };
    mockGithubAppDao.listAppsByAppId.mockResolvedValueOnce([
      {
        id: 'github-app',
        appId: '12345',
        host: 'github.com',
        webhookSecretRef: 'GH_APP_WEBHOOK_SECRET',
        status: 'active',
        ...timestamps,
      },
      {
        id: 'ghes-app',
        appId: '12345',
        host: 'ghe.example.com',
        webhookSecretRef: 'GHES_APP_WEBHOOK_SECRET',
        status: 'active',
        ...timestamps,
      },
    ]);
    const payload = JSON.stringify({
      action: 'deleted',
      installation: {
        id: 778,
        app_id: 12345,
        account: { login: 'enterprise-org' },
      },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, 'enterprise-secret'))
      .set('X-GitHub-Delivery', 'delivery-overlapping-app-id')
      .send(payload);

    expect(res.status).toBe(200);
    expect(
      mockInstallationDao.deleteByAppAndInstallationId,
    ).toHaveBeenCalledWith('12345', 778, 'ghe.example.com');
  });

  it('continues verification when one matching app secret is unavailable', async () => {
    failingSecretRef = 'BROKEN_WEBHOOK_SECRET';
    process.env.GHES_APP_WEBHOOK_SECRET = 'enterprise-secret';
    const timestamps = {
      createdAt: '2026-09-03T00:00:00.000Z',
      updatedAt: '2026-09-03T00:00:00.000Z',
    };
    mockGithubAppDao.listAppsByAppId.mockResolvedValueOnce([
      {
        id: 'broken-app',
        appId: '12345',
        host: 'github.com',
        webhookSecretRef: 'BROKEN_WEBHOOK_SECRET',
        status: 'active',
        ...timestamps,
      },
      {
        id: 'ghes-app',
        appId: '12345',
        host: 'ghe.example.com',
        webhookSecretRef: 'GHES_APP_WEBHOOK_SECRET',
        status: 'active',
        ...timestamps,
      },
    ]);
    const payload = JSON.stringify({
      action: 'deleted',
      installation: {
        id: 779,
        app_id: 12345,
        account: { login: 'enterprise-org' },
      },
    });

    const res = await sendWebhook()
      .set('X-GitHub-Event', 'installation')
      .set('X-Hub-Signature-256', signPayload(payload, 'enterprise-secret'))
      .set('X-GitHub-Delivery', 'delivery-unavailable-candidate')
      .send(payload);

    expect(res.status).toBe(200);
    expect(
      mockInstallationDao.deleteByAppAndInstallationId,
    ).toHaveBeenCalledWith('12345', 779, 'ghe.example.com');
  });
});
