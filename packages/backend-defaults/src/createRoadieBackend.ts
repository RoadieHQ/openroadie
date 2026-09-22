import { ServiceFactory } from '@roadiehq/extensions-api';
import { createSpecializedBackend } from './wiring';
import {
  authServiceFactory,
  configLoggerServiceFactory,
  databaseServiceFactory,
  discoveryServiceFactory,
  eventsServiceFactory,
  httpAuthServiceFactory,
  httpRouterServiceFactory,
  lifecycleServiceFactory,
  loggerServiceFactory,
  RoadieMiddlewareFactory,
  rootConfigServiceFactory,
  rootDatabaseServiceFactory,
  rootHealthServiceFactory,
  rootHttpRouterServiceFactory,
  rootLifecycleServiceFactory,
  rootLoggerServiceFactory,
  schedulerServiceFactory,
  type RootHttpRouterConfigureContext,
  catalogDatabaseServiceFactory,
} from './services';
import compression from 'compression';
import {
  configureActiveRequestMetrics,
  MiddlewareFactory,
} from './middlewares';
import { serveFrontend } from './frontend/serveFrontend';
import type { Express, Request } from 'express';
import { readFileSync } from 'fs';
import { resolvePackagePath } from '@roadiehq/extensions-api';
import { Config } from '@roadiehq/config';

const defaultServiceFactories: ServiceFactory[] = [
  authServiceFactory,
  configLoggerServiceFactory,
  databaseServiceFactory,
  discoveryServiceFactory,
  eventsServiceFactory,
  httpAuthServiceFactory,
  httpRouterServiceFactory,
  lifecycleServiceFactory,
  loggerServiceFactory,
  rootConfigServiceFactory,
  rootDatabaseServiceFactory,
  rootHealthServiceFactory,
  rootLifecycleServiceFactory,
  rootLoggerServiceFactory,
  schedulerServiceFactory,
];

/**
 * The API description.
 *
 * Served so a client can pin a version of the contract rather than vendoring a
 * copy — a Terraform provider is the motivating case. Read once and cached: a
 * 150KB document that cannot change at runtime.
 *
 * Served as YAML rather than converted to JSON so this package needs no YAML
 * parser at runtime. `yaml` resolves here today only by hoisting, and an
 * undeclared dependency would break a clean install of the published package.
 *
 * Kept in this package rather than the frontend that used to hold it, because
 * this is the assembly that owns the routes it describes, and both the OSS and
 * multi-tenant entries call `createRoadieBackend`.
 */
let cachedSpec: string | undefined;
function loadOpenApiSpec(): string {
  if (cachedSpec === undefined) {
    cachedSpec = readFileSync(
      resolvePackagePath('@roadiehq/backend-defaults', 'src/openapi.yaml'),
      'utf8',
    );
  }
  return cachedSpec;
}

export interface CreateRoadieBackendOptions {
  serviceFactoryOverrides?: ServiceFactory[];
  /**
   * Optional callback to extract per-request context for logging.
   * Called when each request completes. Returns key-value pairs
   * that will be included in the request log output.
   */
  getLoggingContext?: (
    req: Request,
  ) => Record<string, string | undefined> | undefined;
}

export const createRoadieBackend = (
  extendApi?: ({ app, config }: { app: Express; config: Config }) => void,
  options?: CreateRoadieBackendOptions,
) => {
  const factories = [...defaultServiceFactories];
  for (const override of options?.serviceFactoryOverrides ?? []) {
    const idx = factories.findIndex(f => f.service.id === override.service.id);
    if (idx !== -1) {
      factories[`${idx}`] = override;
    } else {
      factories.push(override);
    }
  }
  const backend = createSpecializedBackend({
    defaultServiceFactories: factories,
  });

  backend.add(import('@roadiehq/healthcheck-backend'));
  backend.add(catalogDatabaseServiceFactory);

  backend.add(
    rootHttpRouterServiceFactory({
      configure: (context: RootHttpRouterConfigureContext) => {
        const { app, config, logger, routes } = context;
        const roadieMiddleware = MiddlewareFactory.create({
          config,
          logger,
        });
        const frameworkMiddlewares = RoadieMiddlewareFactory.create({
          config,
          logger,
        });

        app.use(configureActiveRequestMetrics());
        app.use(
          roadieMiddleware.requestLoggingHandler({
            getContext: options?.getLoggingContext,
          }),
        );

        app.use('/api', [
          roadieMiddleware.cors(),
          roadieMiddleware.serverBackend(),
          roadieMiddleware.trace(),
        ]);

        // Ahead of `extendApi` so an overlay can replace it if it needs to.
        app.get('/api/openapi.yaml', (_req, res) => {
          res.type('application/yaml').send(loadOpenApiSpec());
        });

        extendApi?.({ app, config });

        app.use('/', [
          roadieMiddleware.metrics(),
          roadieMiddleware.otelMetrics(),
        ]);

        app.use(frameworkMiddlewares.helmet());
        app.use(frameworkMiddlewares.cors());
        // Custom compression that skips SSE streams to allow AI chat streaming (from AI SDK v6 upgrade)
        app.use(
          compression({
            filter: (req, res) => {
              const contentType = res.getHeader('Content-Type');
              if (contentType?.toString().includes('text/event-stream')) {
                return false;
              }
              return compression.filter(req, res);
            },
          }),
        );
        app.use(routes);

        // Standalone distribution: serve the prebuilt frontend (UI + /api on
        // one origin) when a web directory is provided. No-op otherwise, so the
        // split dev/Docker setup is unaffected. Registered after plugin routers
        // and before notFound so /api/* is never shadowed.
        const webDir = process.env.OPENROADIE_WEB_DIR;
        if (webDir) {
          serveFrontend(app, config, webDir);
          logger.info(`Serving frontend from ${webDir}`);
        }

        app.use(frameworkMiddlewares.notFound());
        app.use(frameworkMiddlewares.error({ showStackTraces: true }));
      },
    }),
  );

  return backend;
};
