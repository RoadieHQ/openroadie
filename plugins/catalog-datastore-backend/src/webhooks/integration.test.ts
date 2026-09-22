/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { randomBytes, randomUUID } from 'crypto';
import express from 'express';
import knex, { Knex } from 'knex';
import supertest from 'supertest';
import {
  ObjectDao,
  DatasourceActivityDao,
  WebhookSubscriptionDao,
  WebhookTokenDao,
  applyMigrations,
} from '../database';
import { WebhooksController } from '../api/webhooks';
import { DatasourcesController } from '../api/datasources';
import { DatasourceEvents } from './DatasourceEvents';
import { WebhookEmitter } from './WebhookEmitter';
import { signBody, SIGNATURE_HEADER } from './signing';
import { resetSharedDatasourceEventsForTesting } from './sharedState';
import { DbTokenVerifier } from './verifiers';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
} as unknown as ConstructorParameters<typeof WebhookEmitter>[0]['logger'];

const SUPERUSER_DB = 'postgres';
const PG_HOST = process.env.ROADIE_TEST_PG_HOST ?? 'localhost';
const PG_USER =
  process.env.ROADIE_TEST_PG_USER ?? process.env.USER ?? 'postgres';
const PG_PORT = Number(process.env.ROADIE_TEST_PG_PORT ?? 5432);

async function connect(database: string): Promise<Knex> {
  return knex({
    client: 'pg',
    connection: {
      host: PG_HOST,
      port: PG_PORT,
      user: PG_USER,
      database,
    },
    pool: { min: 0, max: 2 },
  });
}

describe('webhook system — end-to-end against local postgres', () => {
  const dbName = `webhook_it_${randomBytes(6).toString('hex')}`;
  let admin: Knex;
  let db: Knex;

  beforeAll(async () => {
    admin = await connect(SUPERUSER_DB);
    await admin.raw(`CREATE DATABASE "${dbName}"`);
    db = await connect(dbName);
    await applyMigrations(db);
  }, 30_000);

  afterAll(async () => {
    if (db) await db.destroy();
    if (admin) {
      await admin.raw(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ?`,
        [dbName],
      );
      await admin.raw(`DROP DATABASE IF EXISTS "${dbName}"`);
      await admin.destroy();
    }
    resetSharedDatasourceEventsForTesting();
  });

  it('mints a token, registers a subscription, fires a signed webhook on object write, and serves the reconcile query', async () => {
    const tokenDao = new WebhookTokenDao({ knex: db });
    const subscriptionDao = new WebhookSubscriptionDao({ knex: db });
    const activityDao = new DatasourceActivityDao({ knex: db });
    const events = new DatasourceEvents();

    const objectDao = new ObjectDao({ knex: db, activityDao, events });
    const verifier = new DbTokenVerifier(tokenDao);

    // Boot the routers exactly as the plugin does.
    const app = express();
    const webhooksController = new WebhooksController({
      subscriptionDao,
      tokenDao,
      verifier,
    });
    app.use('/api/webhooks', await webhooksController.getPublicRouter());
    app.use(
      '/api/catalog-datastore/webhooks',
      await webhooksController.getAdminRouter(),
    );
    app.use(
      '/api/datasources',
      await new DatasourcesController({
        activityDao,
        verifier,
      }).getRouter(),
    );

    // Receiver: a tiny in-process server that captures the webhook delivery.
    const received: Array<{
      headers: Record<string, string | string[] | undefined>;
      body: unknown;
    }> = [];
    const receiver = express();
    receiver.use(express.json());
    receiver.post('/cb', (req, res) => {
      received.push({ headers: req.headers, body: req.body });
      res.status(202).end();
    });
    const server = receiver.listen(0);
    const { port } = server.address() as { port: number };
    const callbackUrl = `http://127.0.0.1:${port}/cb`;

    // Wire the emitter to the events bus (debounce 50ms for fast test).
    const emitter = new WebhookEmitter({
      logger: noopLogger,
      subscriptionDao,
      events,
      debounceMs: 50,
    });

    try {
      // 1. Admin mints a token. Admin endpoints live under the plugin
      //    namespace (/api/catalog-datastore/webhooks); in production, the
      //    platform's user-session middleware applies there. The OSS-public
      //    endpoint at /api/webhooks/subscriptions is bearer-protected only.
      const tokenResp = await supertest(app)
        .post('/api/catalog-datastore/webhooks/tokens')
        .send({ label: 'integration-test' })
        .expect(201);
      const { token: plaintextToken } = tokenResp.body as { token: string };
      expect(plaintextToken).toMatch(/^[0-9a-f]{64}$/);

      // 2. OSS plugin (simulated) registers a subscription with bearer auth.
      const ossSecret = 'oss-side-hmac-secret';
      const registerResp = await supertest(app)
        .post('/api/webhooks/subscriptions')
        .set('Authorization', `Bearer ${plaintextToken}`)
        .send({
          url: callbackUrl,
          secret: ossSecret,
          filters: { pluginId: 'datasources' },
        })
        .expect(200);
      expect(registerResp.body.subscriptionId).toBeTruthy();

      // 3. Re-register with same URL → 409 + same id (idempotent, no race).
      const dupResp = await supertest(app)
        .post('/api/webhooks/subscriptions')
        .set('Authorization', `Bearer ${plaintextToken}`)
        .send({ url: callbackUrl, secret: 'different', filters: {} })
        .expect(409);
      expect(dupResp.body.subscriptionId).toBe(
        registerResp.body.subscriptionId,
      );

      // 3b. Concurrent re-registration with the same URL must return 409
      //     deterministically (no 500 from the unique constraint racing).
      const concurrent = await Promise.all(
        Array.from({ length: 5 }, () =>
          supertest(app)
            .post('/api/webhooks/subscriptions')
            .set('Authorization', `Bearer ${plaintextToken}`)
            .send({ url: callbackUrl, secret: 'concurrent', filters: {} }),
        ),
      );
      for (const resp of concurrent) {
        expect([200, 409]).toContain(resp.status);
        expect(resp.body.subscriptionId).toBe(registerResp.body.subscriptionId);
      }

      // 4. Bad bearer is rejected on the public route.
      await supertest(app)
        .post('/api/webhooks/subscriptions')
        .set('Authorization', 'Bearer not-a-real-token')
        .send({ url: 'http://other/cb', secret: 's', filters: {} })
        .expect(401);

      // 4b. Missing secret is rejected with 400 (the caller needs the
      //     secret to verify HMAC; we won't generate one server-side and
      //     leave them with a silently-broken subscription).
      await supertest(app)
        .post('/api/webhooks/subscriptions')
        .set('Authorization', `Bearer ${plaintextToken}`)
        .send({ url: 'http://other-no-secret/cb', filters: {} })
        .expect(400);
      await supertest(app)
        .post('/api/webhooks/subscriptions')
        .set('Authorization', `Bearer ${plaintextToken}`)
        .send({ url: 'http://other-empty-secret/cb', secret: '', filters: {} })
        .expect(400);

      // 5. Trigger a real datastore write through ObjectDao —
      //    simulating what a workflow sink or HTTP write would do.
      const datasourceId = randomUUID();
      // Insert a row directly so deleteAllDatastoreItems has something to delete
      // and the activity touch + event emission both fire.
      await db('datastore').insert({
        id: randomUUID(),
        datasource_id: datasourceId,
        object_id: 'obj-1',
        object: JSON.stringify({ hello: 'world' }),
      });
      await objectDao.deleteAllDatastoreItems(datasourceId);

      // 6. Wait for the debounce to fire and HTTP delivery to land.
      const deadline = Date.now() + 5_000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 25));
      }
      expect(received).toHaveLength(1);

      // 7. Verify the webhook payload + signature byte-for-byte.
      const delivered = received[0];
      const rawBody = JSON.stringify(delivered.body);
      const expectedSig = signBody(ossSecret, rawBody);
      // eslint-disable-next-line security/detect-object-injection
      expect(delivered.headers[SIGNATURE_HEADER]).toBe(expectedSig);
      expect(delivered.body).toMatchObject({
        event: 'datasource-updated',
        metadata: { datasourceId, status: 'success' },
      });

      // 8. Reconcile query returns the freshly-touched datasource.
      const reconcileResp = await supertest(app)
        .get('/api/datasources?updated_since=2020-01-01T00:00:00.000Z')
        .set('Authorization', `Bearer ${plaintextToken}`)
        .expect(200);
      const items = reconcileResp.body.items as Array<{
        datasourceId: string;
        updatedAt: string;
      }>;
      expect(items.some(it => it.datasourceId === datasourceId)).toBe(true);

      // 9. Reconcile query rejects bad bearer.
      await supertest(app)
        .get('/api/datasources?updated_since=2020-01-01T00:00:00.000Z')
        .expect(401);
    } finally {
      emitter.stop();
      server.close();
    }
  }, 30_000);
});
