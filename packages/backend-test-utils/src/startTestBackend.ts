/*
 * Copyright 2025 Larder Software Ltd.
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

import express, { Express, Router, RequestHandler } from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  BackendFeature,
  ServiceFactory,
  coreServices,
  LoggerService,
  RootHttpRouterService,
  HttpRouterService,
  ExtensionPoint,
} from '@roadiehq/extensions-api';
import { ConfigReader } from '@roadiehq/config';

/**
 * Extended HTTP server interface for test backend.
 * @public
 */
export interface ExtendedHttpServer extends http.Server {
  /** Provide easy access to port */
  port(): number;
}

/**
 * The test backend instance.
 * @public
 */
export interface TestBackend {
  /**
   * Provides access to the underlying HTTP server for use with utilities
   * such as `supertest`.
   */
  readonly server: ExtendedHttpServer;
  /**
   * Stops the test backend.
   */
  stop(): Promise<void>;
}

/**
 * Options for starting a test backend.
 * @public
 */
export interface TestBackendOptions<TExtensionPoints extends unknown[]> {
  extensionPoints?: readonly [
    ...{
      [index in keyof TExtensionPoints]: [
        ExtensionPoint<TExtensionPoints[index]>,
        Partial<TExtensionPoints[index]>,
      ];
    },
  ];
  features?: Array<BackendFeature | Promise<{ default: BackendFeature }>>;
}

class TestRootHttpRouter implements RootHttpRouterService {
  #routes = Router();

  use(path: string, handler: RequestHandler): void {
    this.#routes.use(path, handler);
  }

  handler(): RequestHandler {
    return this.#routes;
  }
}

function createMockLogger(): LoggerService {
  const logger: LoggerService = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => logger,
  };
  return logger;
}

class TestBackendImpl {
  #app: Express;
  #server: http.Server | undefined;
  #rootRouter: TestRootHttpRouter;
  #pluginRouters = new Map<string, Router>();
  #features: Array<BackendFeature | Promise<{ default: BackendFeature }>> = [];
  #extensionPointImpls = new Map<string, unknown>();
  #logger: LoggerService;
  #config: ConfigReader;
  #started = false;

  constructor() {
    this.#app = express();
    this.#rootRouter = new TestRootHttpRouter();
    this.#logger = createMockLogger();
    this.#config = new ConfigReader({
      backend: {
        listen: {
          port: 0, // Random port
        },
      },
    });
  }

  add(feature: BackendFeature | Promise<{ default: BackendFeature }>): void {
    this.#features.push(feature);
  }

  addExtensionPoint<T>(point: ExtensionPoint<T>, impl: Partial<T>): void {
    this.#extensionPointImpls.set(point.id, impl);
  }

  setConfig(config: ConfigReader): void {
    this.#config = config;
  }

  async start(): Promise<{ server: ExtendedHttpServer }> {
    if (this.#started) {
      throw new Error('Test backend already started');
    }
    this.#started = true;

    for (const featureOrPromise of this.#features) {
      const feature =
        'then' in featureOrPromise
          ? (await featureOrPromise).default
          : featureOrPromise;

      await this.#processFeature(feature);
    }

    this.#app.use(express.json());
    this.#app.use(this.#rootRouter.handler());

    return new Promise((resolve, reject) => {
      this.#server = http.createServer(this.#app);

      this.#server.on('error', reject);

      this.#server.listen(0, '127.0.0.1', () => {
        const address = this.#server!.address() as AddressInfo;

        const extendedServer = this.#server as ExtendedHttpServer;
        extendedServer.port = () => address.port;

        resolve({ server: extendedServer });
      });
    });
  }

  async #processFeature(feature: BackendFeature): Promise<void> {
    const internal = feature as {
      $$type?: string;
      version?: string;
      featureType?: string;
      service?: { id: string };
      getRegistrations?: () => Array<{
        type: string;
        pluginId: string;
        init: {
          deps: Record<string, unknown>;
          func: (deps: Record<string, unknown>) => Promise<void>;
        };
      }>;
    };

    if (internal.featureType === 'service' || 'service' in internal) {
      const serviceFactory = feature as ServiceFactory;
      if (serviceFactory.service.id === coreServices.rootConfig.id) {
        // Access the internal factory function
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const internalFactory = serviceFactory as any;
        if (internalFactory.factory) {
          this.#config = (await internalFactory.factory({})) as ConfigReader;
        }
      }
      return;
    }

    if (internal.featureType === 'registrations' && internal.getRegistrations) {
      const registrations = internal.getRegistrations();
      for (const reg of registrations) {
        if (reg.type === 'plugin' || reg.type === 'plugin-v1.1') {
          await this.#initPlugin(reg.pluginId, reg);
        }
      }
    }
  }

  async #initPlugin(
    pluginId: string,
    registration: {
      init: {
        deps: Record<string, unknown>;
        func: (deps: Record<string, unknown>) => Promise<void>;
      };
    },
  ): Promise<void> {
    const pluginRouter = Router();
    this.#pluginRouters.set(pluginId, pluginRouter);

    const deps: Record<string, unknown> = {};

    for (const [name, ref] of Object.entries(registration.init.deps)) {
      const serviceRef = ref as { id: string };

      if (this.#extensionPointImpls.has(serviceRef.id)) {
        deps[name] = this.#extensionPointImpls.get(serviceRef.id);
        continue;
      }

      switch (serviceRef.id) {
        case coreServices.logger.id:
          deps[name] = this.#logger.child({ plugin: pluginId });
          break;
        case coreServices.rootConfig.id:
          deps[name] = this.#config;
          break;
        case coreServices.httpRouter.id:
          deps[name] = {
            use: (handler: RequestHandler) => {
              this.#rootRouter.use(`/api/${pluginId}`, handler);
            },
            addAuthPolicy: () => {},
          } as HttpRouterService;
          break;
        case coreServices.discovery.id:
          deps[name] = {
            getBaseUrl: async (id: string) => {
              const addr = this.#server?.address() as AddressInfo | undefined;
              const port = addr?.port ?? 7007;
              return `http://127.0.0.1:${port}/api/${id}`;
            },
            getExternalBaseUrl: async (id: string) => {
              const addr = this.#server?.address() as AddressInfo | undefined;
              const port = addr?.port ?? 7007;
              return `http://127.0.0.1:${port}/api/${id}`;
            },
          };
          break;
        case coreServices.lifecycle.id:
          deps[name] = {
            addStartupHook: () => {},
            addShutdownHook: () => {},
          };
          break;
        case coreServices.rootLifecycle.id:
          deps[name] = {
            addStartupHook: () => {},
            addShutdownHook: () => {},
          };
          break;
        default:
          deps[name] = {};
      }
    }

    await registration.init.func(deps);
  }

  async stop(): Promise<void> {
    if (this.#server) {
      await new Promise<void>((resolve, reject) => {
        this.#server!.close(err => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.#server = undefined;
    }
  }
}

/**
 * Starts a test backend with the provided features.
 *
 * @public
 */
export async function startTestBackend<TExtensionPoints extends unknown[]>(
  options: TestBackendOptions<TExtensionPoints>,
): Promise<TestBackend> {
  const backend = new TestBackendImpl();

  if (options.extensionPoints) {
    for (const [point, impl] of options.extensionPoints) {
      backend.addExtensionPoint(point, impl);
    }
  }

  if (options.features) {
    for (const feature of options.features) {
      backend.add(feature);
    }
  }

  const { server } = await backend.start();

  return {
    server,
    stop: () => backend.stop(),
  };
}
