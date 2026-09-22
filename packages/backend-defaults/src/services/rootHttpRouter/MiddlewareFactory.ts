/*
 * Copyright 2023 The Backstage Authors
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
 * packages/backend-defaults/src/entrypoints/rootHttpRouter/http/MiddlewareFactory.ts at v1.47.1, and modified.
 */

import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import type { RequestHandler, ErrorRequestHandler, Request } from 'express';
import type {
  LoggerService,
  RootConfigService,
} from '@roadiehq/extensions-api';
import { serializeError } from '../../errors';
import { httpStatusFromExpressError } from '../../httpErrorStatus';

export interface MiddlewareFactoryOptions {
  config: RootConfigService;
  logger: LoggerService;
}

function getLogMeta(
  req: Request,
  res: { statusCode: number; getHeader: (name: string) => unknown },
) {
  const referrer = req.headers.referer ?? req.headers.referrer;
  const userAgent = req.headers['user-agent'];
  const contentLength = Number(res.getHeader('content-length'));

  const meta: Record<string, unknown> = {
    date: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl ?? req.url,
    status: res.statusCode,
    httpVersion: `${req.httpVersionMajor}.${req.httpVersionMinor}`,
  };

  if (userAgent) {
    meta.userAgent = userAgent;
  }
  if (isFinite(contentLength)) {
    meta.contentLength = contentLength;
  }
  if (referrer) {
    meta.referrer = Array.isArray(referrer) ? referrer.join(', ') : referrer;
  }
  return meta;
}

/**
 * Middleware factory for common HTTP middleware.
 */
export class MiddlewareFactory {
  #config: RootConfigService;
  #logger: LoggerService;

  static create(options: MiddlewareFactoryOptions): MiddlewareFactory {
    return new MiddlewareFactory(options);
  }

  private constructor(options: MiddlewareFactoryOptions) {
    this.#config = options.config;
    this.#logger = options.logger;
  }

  /**
   * Returns a 404 not found middleware.
   */
  notFound(): RequestHandler {
    return (_req, res) => {
      res.status(404).end();
    };
  }

  /**
   * Returns compression middleware.
   */
  compression(): RequestHandler {
    return compression();
  }

  /**
   * Returns request logging middleware.
   */
  logging(): RequestHandler {
    const logger = this.#logger;
    return (req, res, next) => {
      res.on('finish', () => {
        const meta = getLogMeta(req, res);
        logger.info(
          `[${meta.date}] "${meta.method} ${meta.url} HTTP/${meta.httpVersion}" ${meta.status} ${meta.contentLength ?? 0} "${meta.referrer ?? '-'}" "${meta.userAgent ?? '-'}"`,
          {
            type: 'incomingRequest',
            ...meta,
          },
        );
      });
      next();
    };
  }

  /**
   * Returns helmet security middleware.
   */
  helmet(): RequestHandler {
    const backendConfig = this.#config.getOptionalConfig('backend');
    const cspConfig = backendConfig?.getOptionalConfig('csp');

    const directiveEntries: Array<[string, string[]]> = [];
    if (cspConfig) {
      for (const key of cspConfig.keys()) {
        directiveEntries.push([key, cspConfig.getStringArray(key)]);
      }
    }
    const directives = Object.fromEntries(directiveEntries);

    return helmet({
      contentSecurityPolicy:
        directiveEntries.length > 0 ? { directives } : false,
    });
  }

  /**
   * Returns CORS middleware.
   */
  cors(): RequestHandler {
    const backendConfig = this.#config.getOptionalConfig('backend');
    const corsConfig = backendConfig?.getOptionalConfig('cors');
    const appBaseUrl = this.#config.getOptionalString('app.baseUrl');

    if (!corsConfig) {
      return cors();
    }

    const configuredOrigins = corsConfig.getOptionalStringArray('origin');
    const origin = configuredOrigins
      ? Array.from(
          new Set([...(appBaseUrl ? [appBaseUrl] : []), ...configuredOrigins]),
        )
      : true;

    return cors({
      origin,
      methods: corsConfig.getOptionalStringArray('methods'),
      allowedHeaders: corsConfig.getOptionalStringArray('allowedHeaders'),
      exposedHeaders: corsConfig.getOptionalStringArray('exposedHeaders'),
      credentials: corsConfig.getOptionalBoolean('credentials'),
      maxAge: corsConfig.getOptionalNumber('maxAge'),
    });
  }

  /**
   * Returns rate limiting middleware (no-op if not configured).
   */
  rateLimit(): RequestHandler {
    const enabled = this.#config.has('backend.rateLimit');
    if (!enabled) {
      return (_req, _res, next) => {
        next();
      };
    }

    // Simplified rate limiting - can be enhanced later
    return (_req, _res, next) => {
      next();
    };
  }

  /**
   * Returns error handling middleware.
   */
  error(options?: { showStackTraces?: boolean }): ErrorRequestHandler {
    const showStackTraces = options?.showStackTraces ?? false;
    const logger = this.#logger;

    return (err, _req, res, next) => {
      if (res.headersSent) {
        next(err);
        return;
      }

      const status = httpStatusFromExpressError(err);

      if (status >= 500) {
        logger.error('Internal server error', err);
      }

      const serialized = serializeError(err, { includeStack: showStackTraces });
      res.status(status).json({ error: serialized });
    };
  }
}
