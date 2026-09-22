/*
 * Copyright 2022 The Backstage Authors
 * Modifications copyright 2024 Larder Software Limited
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
 *
 * Derived from Backstage (https://github.com/backstage/backstage),
 * packages/backend-defaults/src/entrypoints/httpRouter/httpRouterServiceFactory.ts at v1.47.1, and modified.
 */

import Router from 'express-promise-router';
import {
  coreServices,
  createServiceFactory,
  HttpRouterService,
  HttpRouterServiceAuthPolicy,
} from '@roadiehq/extensions-api';
import type { ErrorRequestHandler } from 'express';
import { httpStatusFromExpressError } from '../../httpErrorStatus';

/**
 * HTTP router service factory.
 * Provides HTTP routing capabilities for each plugin.
 */
export const httpRouterServiceFactory = createServiceFactory({
  service: coreServices.httpRouter,
  initialization: 'always',
  deps: {
    plugin: coreServices.pluginMetadata,
    config: coreServices.rootConfig,
    lifecycle: coreServices.lifecycle,
    rootHttpRouter: coreServices.rootHttpRouter,
    auth: coreServices.auth,
    httpAuth: coreServices.httpAuth,
    logger: coreServices.logger,
  },
  async factory({
    config: _config,
    plugin,
    rootHttpRouter,
    lifecycle: _lifecycle,
    logger,
    httpAuth: _httpAuth,
  }): Promise<HttpRouterService> {
    const router = Router();
    const pluginId = plugin.getId();

    rootHttpRouter.use(`/api/${pluginId}`, router);

    const pluginRoutes = Router();
    router.use(pluginRoutes);

    const authPolicies: HttpRouterServiceAuthPolicy[] = [];

    const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
      if (res.headersSent) {
        next(err);
        return;
      }

      const error = err as Error;
      const status = httpStatusFromExpressError(err);
      logger.error(`Error in ${pluginId}: ${error.message}`, error);

      res.status(status).json({
        error: {
          name: error.name,
          message: error.message,
        },
      });
    };
    router.use(errorHandler);

    return {
      use(handler) {
        pluginRoutes.use(handler);
      },
      addAuthPolicy(policy) {
        authPolicies.push(policy);
      },
    };
  },
});
