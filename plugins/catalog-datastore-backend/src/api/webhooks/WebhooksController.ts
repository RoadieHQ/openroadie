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
import { Request, RequestHandler, json } from 'express';
import Router from 'express-promise-router';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import { WebhookSubscriptionDao } from '../../database/WebhookSubscriptionDao';
import { hashToken, WebhookTokenDao } from '../../database/WebhookTokenDao';
import { createBearerAuthMiddleware } from '../../webhooks/bearerAuth';
import type { BearerVerifier } from '../../webhooks/verifiers';
import {
  defaultCurrentScopeIdResolver,
  noopSubjectScopeIndex,
  type CurrentScopeIdResolver,
  type SubjectScopeIndex,
} from '@roadiehq/integrations-node';

export const WEBHOOK_TOKEN_SUBJECT_TYPE = 'webhook:token';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class WebhooksController {
  private readonly subscriptionDao: WebhookSubscriptionDao;
  private readonly tokenDao: WebhookTokenDao;
  private readonly verifier: BearerVerifier;
  private readonly resolveWorkspaceId: (req: Request) => Promise<string>;
  private readonly subjectScopeIndex: SubjectScopeIndex;
  private readonly currentScopeIdResolver: CurrentScopeIdResolver;
  private readonly publicWorkspaceIds = new WeakMap<Request, string>();
  private readonly adminWorkspaceIds = new WeakMap<Request, string>();

  constructor(opts: {
    subscriptionDao: WebhookSubscriptionDao;
    tokenDao: WebhookTokenDao;
    verifier: BearerVerifier;
    resolveWorkspaceId?: (req: Request) => Promise<string>;
    subjectScopeIndex?: SubjectScopeIndex;
    currentScopeIdResolver?: CurrentScopeIdResolver;
  }) {
    this.subscriptionDao = opts.subscriptionDao;
    this.tokenDao = opts.tokenDao;
    this.verifier = opts.verifier;
    this.resolveWorkspaceId =
      opts.resolveWorkspaceId ?? (async () => DEFAULT_WORKSPACE_ID);
    this.subjectScopeIndex = opts.subjectScopeIndex ?? noopSubjectScopeIndex;
    this.currentScopeIdResolver =
      opts.currentScopeIdResolver ?? defaultCurrentScopeIdResolver;
  }

  /**
   * OSS-public routes mounted at /api/webhooks via rootHttpRouter so the path
   * matches the OSS UpstreamSubscriptionClient's hardcoded URLs. Bearer-auth
   * via WebhookTokenDao gates the only mutating endpoint.
   */
  async getPublicRouter() {
    const router = Router();
    const bearerAuth = createBearerAuthMiddleware({
      verifier: this.verifier,
      onVerified: (req, workspaceId) =>
        this.publicWorkspaceIds.set(req, workspaceId),
    });
    router.post('/subscriptions', bearerAuth, json(), this.register);
    return router;
  }

  /**
   * Admin routes mounted under the catalog-datastore plugin's own httpRouter,
   * so the platform's user-session auth middleware applies. These manage
   * tokens and revoke subscriptions; they must not be exposed publicly.
   */
  async getAdminRouter() {
    const router = Router();
    router.use(async (req, _res, next) => {
      try {
        this.adminWorkspaceIds.set(req, await this.resolveWorkspaceId(req));
        next();
      } catch (error) {
        next(error);
      }
    });
    router.get('/subscriptions', async (req, res) => {
      const items = await this.subscriptionDao.list(this.adminWorkspaceId(req));
      res.json({
        items: items.map(s => ({
          id: s.id,
          url: s.url,
          filters: s.filters,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      });
    });
    router.delete('/subscriptions/:id', async (req, res) => {
      const ok = await this.subscriptionDao.deleteById(
        req.params.id,
        this.adminWorkspaceId(req),
      );
      if (!ok) {
        res.status(404).json({ error: { message: 'subscription not found' } });
        return;
      }
      res.status(204).end();
    });
    router.post('/tokens', json(), this.createToken);
    router.get('/tokens', async (req, res) => {
      res.json({ items: await this.tokenDao.list(this.adminWorkspaceId(req)) });
    });
    router.delete('/tokens/:id', async (req, res) => {
      const workspaceId = this.adminWorkspaceId(req);
      const tokenHash = await this.tokenDao.deleteById(
        req.params.id,
        workspaceId,
      );
      if (!tokenHash) {
        res.status(404).json({ error: { message: 'token not found' } });
        return;
      }
      await this.subjectScopeIndex.remove({
        subjectType: WEBHOOK_TOKEN_SUBJECT_TYPE,
        subjectId: tokenHash,
        scopeId: await this.currentScopeIdResolver.getCurrentScopeId(),
      });
      res.status(204).end();
    });
    return router;
  }

  private adminWorkspaceId(req: Request): string {
    return this.adminWorkspaceIds.get(req) ?? DEFAULT_WORKSPACE_ID;
  }

  register: RequestHandler = async (req, res) => {
    const body = req.body as
      | { url?: unknown; secret?: unknown; filters?: unknown }
      | undefined;
    if (!body || typeof body.url !== 'string' || body.url.length === 0) {
      res.status(400).json({ error: { message: 'url is required' } });
      return;
    }
    // The caller must supply the HMAC secret — they need it on their side
    // to verify incoming webhook signatures. The OSS UpstreamSubscriptionClient
    // always sends it; rejecting a missing/empty secret prevents creating a
    // subscription whose owner cannot verify deliveries.
    if (typeof body.secret !== 'string' || body.secret.length === 0) {
      res.status(400).json({ error: { message: 'secret is required' } });
      return;
    }
    const url: string = body.url;
    const secret: string = body.secret;
    const filters = isPlainObject(body.filters) ? body.filters : {};

    const result = await this.subscriptionDao.register({
      workspaceId: this.publicWorkspaceIds.get(req) ?? DEFAULT_WORKSPACE_ID,
      url,
      secret,
      filters,
    });
    res
      .status(result.alreadyExisted ? 409 : 200)
      .json({ subscriptionId: result.subscription.id });
  };

  createToken: RequestHandler = async (req, res) => {
    const body = req.body as { label?: unknown } | undefined;
    if (!body || typeof body.label !== 'string' || body.label.length === 0) {
      res.status(400).json({ error: { message: 'label is required' } });
      return;
    }
    const result = await this.tokenDao.create({
      workspaceId: this.adminWorkspaceId(req),
      label: body.label,
    });
    try {
      await this.subjectScopeIndex.record({
        subjectType: WEBHOOK_TOKEN_SUBJECT_TYPE,
        subjectId: hashToken(result.plaintext),
        scopeId: await this.currentScopeIdResolver.getCurrentScopeId(),
      });
    } catch (error) {
      await this.tokenDao.deleteById(
        result.summary.id,
        result.summary.workspaceId,
      );
      throw error;
    }
    res.status(201).json({ ...result.summary, token: result.plaintext });
  };
}
