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
import { Request, RequestHandler } from 'express';
import Router from 'express-promise-router';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import { DatasourceActivityDao } from '../../database/DatasourceActivityDao';
import { createBearerAuthMiddleware } from '../../webhooks/bearerAuth';
import type { BearerVerifier } from '../../webhooks/verifiers';

export class DatasourcesController {
  private readonly activityDao: DatasourceActivityDao;
  private readonly verifier: BearerVerifier;
  private readonly workspaceIds = new WeakMap<Request, string>();

  constructor(opts: {
    activityDao: DatasourceActivityDao;
    verifier: BearerVerifier;
  }) {
    this.activityDao = opts.activityDao;
    this.verifier = opts.verifier;
  }

  async getRouter() {
    const router = Router();
    const bearerAuth = createBearerAuthMiddleware({
      verifier: this.verifier,
      onVerified: (req, workspaceId) => this.workspaceIds.set(req, workspaceId),
    });
    router.get('/', bearerAuth, this.list);
    return router;
  }

  list: RequestHandler = async (req, res) => {
    const since = req.query.updated_since;
    if (typeof since !== 'string' || since.length === 0) {
      res.status(400).json({
        error: { message: 'updated_since query parameter is required' },
      });
      return;
    }
    if (Number.isNaN(Date.parse(since))) {
      res.status(400).json({
        error: { message: 'updated_since must be an ISO-8601 timestamp' },
      });
      return;
    }
    const items = await this.activityDao.listUpdatedSince(
      since,
      this.workspaceIds.get(req) ?? DEFAULT_WORKSPACE_ID,
    );
    res.json({
      items: items.map(it => ({
        datasourceId: it.datasourceId,
        updatedAt: it.updatedAt,
      })),
    });
  };
}
