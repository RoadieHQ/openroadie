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
 * packages/backend-defaults/src/entrypoints/rootHttpRouter/rootHttpRouterServiceFactory.ts at v1.47.1, and modified.
 */

import express, { Express, RequestHandler, Router } from 'express';
import http from 'node:http';
import https from 'node:https';
import { readCertificateFile } from './readCertificateFile';
import { durationToMilliseconds } from '../../types';
import { readDurationFromConfig } from '@roadiehq/config';
import {
  coreServices,
  createServiceFactory,
  LoggerService,
  RootConfigService,
  RootLifecycleService,
  RootHealthService,
} from '@roadiehq/extensions-api';
import { DefaultRootHttpRouter } from './DefaultRootHttpRouter';
import { MiddlewareFactory } from './MiddlewareFactory';

export interface RootHttpRouterConfigureContext {
  app: Express;
  server: http.Server | https.Server;
  routes: RequestHandler;
  middleware: MiddlewareFactory;
  config: RootConfigService;
  logger: LoggerService;
  lifecycle: RootLifecycleService;
  healthRouter: Router;
  applyDefaults: () => void;
}

export interface RootHttpRouterServiceFactoryOptions {
  indexPath?: string | false;
  configure?: (context: RootHttpRouterConfigureContext) => void;
}

interface HttpServerOptions {
  listen: {
    host?: string;
    port: number;
  };
  https?: {
    certificate: { key: string; cert: string };
  };
}

function readHttpServerOptions(config?: RootConfigService): HttpServerOptions {
  const https = config?.getOptionalConfig('https');
  return {
    listen: {
      host: config?.getOptionalString('listen.host') ?? '::',
      port: config?.getNumber('listen.port') ?? 7007,
    },
    https: https
      ? {
          certificate: {
            key: https.getString('certificate.key'),
            cert: https.getString('certificate.cert'),
          },
        }
      : undefined,
  };
}

function createHealthRouter(options: {
  config: RootConfigService;
  health: RootHealthService;
}): Router {
  const { config, health } = options;
  const router = Router();

  const healthPath =
    config.getOptionalString('backend.health.path') ?? '/.roadie/health/v1';

  router.get(`${healthPath}/liveness`, async (_req, res) => {
    const result = await health.getLiveness();
    res.status(result.status).json(result.payload);
  });

  router.get(`${healthPath}/readiness`, async (_req, res) => {
    const result = await health.getReadiness();
    res.status(result.status).json(result.payload);
  });

  return router;
}

async function createHttpServer(
  app: Express,
  serverOptions: HttpServerOptions,
  options: { logger: LoggerService },
): Promise<{
  server: http.Server | https.Server;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}> {
  const { logger } = options;
  const { listen, https: httpsConfig } = serverOptions;

  let server: http.Server | https.Server;

  if (httpsConfig) {
    const key = readCertificateFile(httpsConfig.certificate.key);
    const cert = readCertificateFile(httpsConfig.certificate.cert);
    server = https.createServer({ key, cert }, app);
  } else {
    server = http.createServer(app);
  }

  return {
    server,
    start: () =>
      new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(listen.port, listen.host ?? '::', () => {
          const protocol = httpsConfig ? 'https' : 'http';
          logger.info(
            `Listening on ${protocol}://${listen.host ?? '::'}:${listen.port}`,
          );
          resolve();
        });
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close(err => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      }),
  };
}

function defaultConfigure({ applyDefaults }: RootHttpRouterConfigureContext) {
  applyDefaults();
}

const rootHttpRouterServiceFactoryWithOptions = (
  options?: RootHttpRouterServiceFactoryOptions,
) =>
  createServiceFactory({
    service: coreServices.rootHttpRouter,
    deps: {
      config: coreServices.rootConfig,
      rootLogger: coreServices.rootLogger,
      lifecycle: coreServices.rootLifecycle,
      health: coreServices.rootHealth,
    },
    async factory({ config, rootLogger, lifecycle, health }) {
      const { indexPath, configure = defaultConfigure } = options ?? {};
      const logger = rootLogger.child({ service: 'rootHttpRouter' });

      const app = express();
      const trustProxy = config.getOptional('backend.trustProxy');

      const router = DefaultRootHttpRouter.create({ indexPath });
      const middleware = MiddlewareFactory.create({ config, logger });
      const routes = router.handler();
      const healthRouter = createHealthRouter({ config, health });

      const httpServer = await createHttpServer(
        app,
        readHttpServerOptions(config.getOptionalConfig('backend')),
        { logger },
      );

      configure({
        app,
        server: httpServer.server,
        routes,
        middleware,
        config,
        logger,
        lifecycle,
        healthRouter,
        applyDefaults() {
          if (process.env.NODE_ENV === 'development') {
            app.set('json spaces', 2);
          }
          if (trustProxy !== undefined) {
            app.set('trust proxy', trustProxy);
          }

          const backendConfig = config.getOptionalConfig('backend');
          const serverConfig = backendConfig?.getOptionalConfig('server');

          if (serverConfig) {
            const readDurationValue = (key: string): number | undefined => {
              if (!serverConfig.has(key)) {
                return undefined;
              }
              const value = serverConfig.getOptional(key);
              if (typeof value === 'number') {
                return value;
              }
              try {
                const duration = readDurationFromConfig(serverConfig, { key });
                return durationToMilliseconds(duration);
              } catch {
                return undefined;
              }
            };

            const headersTimeout = readDurationValue('headersTimeout');
            if (headersTimeout !== undefined) {
              httpServer.server.headersTimeout = headersTimeout;
            }

            const requestTimeout = readDurationValue('requestTimeout');
            if (requestTimeout !== undefined) {
              httpServer.server.requestTimeout = requestTimeout;
            }

            const keepAliveTimeout = readDurationValue('keepAliveTimeout');
            if (keepAliveTimeout !== undefined) {
              httpServer.server.keepAliveTimeout = keepAliveTimeout;
            }

            const timeout = readDurationValue('timeout');
            if (timeout !== undefined) {
              httpServer.server.timeout = timeout;
            }
          }

          app.use(middleware.helmet());
          app.use(middleware.cors());
          app.use(middleware.compression());
          app.use(middleware.logging());
          app.use(middleware.rateLimit());
          app.use(healthRouter);
          app.use(routes);
          app.use(middleware.notFound());
          app.use(middleware.error());
        },
      });

      if (config.has('backend.lifecycle.serverShutdownDelay')) {
        const serverShutdownDelay = readDurationFromConfig(config, {
          key: 'backend.lifecycle.serverShutdownDelay',
        });
        lifecycle.addBeforeShutdownHook(async () => {
          const timeoutMs = durationToMilliseconds(serverShutdownDelay);
          return new Promise(resolve => {
            setTimeout(resolve, timeoutMs);
          });
        });
      }

      lifecycle.addShutdownHook(() => httpServer.stop());
      await httpServer.start();

      return router;
    },
  });

/**
 * Root HTTP router service factory.
 * Can be called with or without options.
 */
export const rootHttpRouterServiceFactory = Object.assign(
  rootHttpRouterServiceFactoryWithOptions,
  rootHttpRouterServiceFactoryWithOptions(),
);

export { MiddlewareFactory };
