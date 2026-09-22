/*
 * Copyright 2024 Larder Software Ltd.
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
import { LoggerService, RootConfigService } from '@roadiehq/extensions-api';
import { metricsHandler } from '@roadiehq/prometheus-metrics';
import {
  NextFunction,
  Request,
  RequestHandler,
  Response,
  Router,
} from 'express';
import { RequestLoggingHandler } from './RequestLoggingHandler';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

export const prometheusExporter = new PrometheusExporter({
  preventServerStart: true,
  prefix: 'otel_',
});

interface MiddlewareFactoryOptions {
  config: RootConfigService;
  logger: LoggerService;
}

export class MiddlewareFactory {
  #config: RootConfigService;
  #logger: LoggerService;
  static create(options: MiddlewareFactoryOptions) {
    return new MiddlewareFactory(options);
  }

  private constructor(options: MiddlewareFactoryOptions) {
    this.#config = options.config;
    this.#logger = options.logger;
  }
  trace(): RequestHandler {
    return (req: Request, _, next: NextFunction) => {
      if (req.headers['roadie-trace']) {
        const { headers } = req;

        const port =
          this.#config.getOptionalNumber('backend.listen.port') || 7000;
        try {
          // eslint-disable-next-line no-restricted-syntax -- fire-and-forget dev trace emitter to the local trace plugin; deliberately unauthenticated and below the service layer.
          fetch(`http://localhost:${port}/api/trace/events`, {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              action: 'http',
              subject: 'roadie-api',
              context: {
                api_event: true,
              },
              attributes: {
                path: req.path,
                method: req.method,
                traceId: headers['roadie-trace'],
              },
            }),
          });
        } catch (e) {
          this.#logger.error(`Unable to post event: ${e}`);
        }
      }
      next();
    };
  }
  serverBackend(): RequestHandler {
    return (_, res: Response, next: NextFunction) => {
      res.set(
        'X-ROADIE-SERVER-BACKEND',
        this.#config.getOptionalString('backend.identity') ??
          this.#config.getOptionalString('scope') ??
          this.#config.getOptionalString('tenant') ??
          'backend',
      );
      next();
    };
  }
  cors(): RequestHandler {
    const configured =
      this.#config.getOptionalStringArray('backend.cors.origin') ??
      [this.#config.getOptionalString('backend.cors.origin')].filter(Boolean);
    const appBaseUrl = this.#config.getOptionalString('app.baseUrl');
    const origins = Array.from(
      new Set([...(appBaseUrl ? [appBaseUrl] : []), ...configured]),
    );

    return (req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers.origin;
      if (origin && origins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header(
          'Access-Control-Allow-Methods',
          'GET, POST, DELETE, PUT, PATCH, OPTIONS',
        );
        res.header(
          'Access-Control-Allow-Headers',
          'Origin, X-Requested-With, Content-Type, Accept, api_key, Authorization',
        );
        res.header('Access-Control-Allow-Credentials', 'true');
      }

      next();
    };
  }
  metrics(): RequestHandler {
    return metricsHandler();
  }
  otelMetrics(): RequestHandler {
    const otelMetricsRouter = Router();
    otelMetricsRouter.get(
      '/otel-metrics',
      async (req: Request, res: Response) =>
        prometheusExporter.getMetricsRequestHandler(req, res),
    );
    return otelMetricsRouter;
  }
  requestLoggingHandler(options?: {
    getContext?: (
      req: Request,
    ) => Record<string, string | undefined> | undefined;
  }): RequestHandler {
    return new RequestLoggingHandler({
      logger: this.#logger,
      config: this.#config,
      getContext: options?.getContext,
    }).handler();
  }
}
