import express from 'express';
import request from 'supertest';
import { vi } from 'vitest';
import { NotAllowedError } from '@roadiehq/errors';
import type { WebhookSubscriptionDao } from '../../database/WebhookSubscriptionDao';
import type { WebhookTokenDao } from '../../database/WebhookTokenDao';
import type { BearerVerifier } from '../../webhooks/verifiers';
import { WebhooksController } from './WebhooksController';

const adminWorkspaceId = '00000000-0000-4000-8000-000000000002';
const tokenWorkspaceId = '00000000-0000-4000-8000-000000000003';

function createController() {
  const subscriptionDao = {
    list: vi.fn(async () => []),
    register: vi.fn(async input => ({
      alreadyExisted: false,
      subscription: {
        id: 'subscription-1',
        workspaceId: input.workspaceId,
        url: input.url,
        secret: input.secret,
        filters: input.filters,
        createdAt: '',
        updatedAt: '',
      },
    })),
    deleteById: vi.fn(async () => 'token-hash'),
  };
  const tokenDao = {
    list: vi.fn(async () => []),
    create: vi.fn(async input => ({
      summary: {
        id: 'token-1',
        workspaceId: input.workspaceId,
        label: input.label,
        createdAt: '',
        lastUsedAt: null,
      },
      plaintext: 'plaintext',
    })),
    deleteById: vi.fn(async () => true),
  };
  const verifier: BearerVerifier = {
    verify: vi.fn(async () => ({ workspaceId: tokenWorkspaceId })),
  };
  const controller = new WebhooksController({
    subscriptionDao: subscriptionDao as unknown as WebhookSubscriptionDao,
    tokenDao: tokenDao as unknown as WebhookTokenDao,
    verifier,
    resolveWorkspaceId: async () => adminWorkspaceId,
  });
  return { controller, subscriptionDao, tokenDao };
}

describe('WebhooksController workspace isolation', () => {
  it('scopes admin reads, writes, and deletes to the selected workspace', async () => {
    const { controller, subscriptionDao, tokenDao } = createController();
    const app = express();
    app.use('/webhooks', await controller.getAdminRouter());

    await request(app).get('/webhooks/subscriptions').expect(200);
    await request(app)
      .post('/webhooks/tokens')
      .send({ label: 'Workspace token' })
      .expect(201);
    await request(app).delete('/webhooks/subscriptions/sub-1').expect(204);
    await request(app).delete('/webhooks/tokens/token-1').expect(204);

    expect(subscriptionDao.list).toHaveBeenCalledWith(adminWorkspaceId);
    expect(subscriptionDao.deleteById).toHaveBeenCalledWith(
      'sub-1',
      adminWorkspaceId,
    );
    expect(tokenDao.create).toHaveBeenCalledWith({
      workspaceId: adminWorkspaceId,
      label: 'Workspace token',
    });
    expect(tokenDao.deleteById).toHaveBeenCalledWith(
      'token-1',
      adminWorkspaceId,
    );
  });

  it('binds public subscriptions to the bearer token workspace', async () => {
    const { controller, subscriptionDao } = createController();
    const app = express();
    app.use('/webhooks', await controller.getPublicRouter());

    await request(app)
      .post('/webhooks/subscriptions')
      .set('Authorization', 'Bearer valid-token')
      .set('x-openroadie-workspace-id', adminWorkspaceId)
      .send({
        url: 'https://example.test/hook',
        secret: 'secret',
        filters: { pluginId: 'datasources' },
      })
      .expect(200);

    expect(subscriptionDao.register).toHaveBeenCalledWith({
      workspaceId: tokenWorkspaceId,
      url: 'https://example.test/hook',
      secret: 'secret',
      filters: { pluginId: 'datasources' },
    });
  });

  it('returns 403 when the public workspace is inaccessible', async () => {
    const { subscriptionDao, tokenDao } = createController();
    const verifier: BearerVerifier = {
      requiresBearer: false,
      verify: vi.fn(async () => {
        throw new NotAllowedError('Workspace is inaccessible');
      }),
    };
    const controller = new WebhooksController({
      subscriptionDao: subscriptionDao as unknown as WebhookSubscriptionDao,
      tokenDao: tokenDao as unknown as WebhookTokenDao,
      verifier,
    });
    const app = express();
    app.use('/webhooks', await controller.getPublicRouter());

    await request(app)
      .post('/webhooks/subscriptions')
      .send({ url: 'https://example.test/hook' })
      .expect(403);

    expect(subscriptionDao.register).not.toHaveBeenCalled();
  });
});
