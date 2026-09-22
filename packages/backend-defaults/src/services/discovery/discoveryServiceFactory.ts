/*
 * Copyright 2020 The Backstage Authors
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
 * packages/backend-defaults/src/entrypoints/discovery/HostDiscovery.ts at v1.47.1, and modified.
 */

import trimEnd from 'lodash/trimEnd';
import {
  coreServices,
  createServiceFactory,
  DiscoveryService,
  LoggerService,
  RootConfigService,
} from '@roadiehq/extensions-api';

interface HttpServerOptions {
  listen: {
    host?: string;
    port: number;
  };
}

function readHttpServerOptions(config?: RootConfigService): HttpServerOptions {
  return {
    listen: {
      host: config?.getOptionalString('listen.host') ?? '::',
      port: config?.getNumber('listen.port') ?? 7007,
    },
  };
}

interface DiscoveryEndpoint {
  target: string | { internal?: string; external?: string };
  plugins: string[];
}

function getEndpoints(config: RootConfigService): DiscoveryEndpoint[] {
  const endpoints: DiscoveryEndpoint[] = [];
  const discoveryConfig = config.getOptionalConfig('discovery');
  if (!discoveryConfig) {
    return endpoints;
  }

  const endpointsConfig = discoveryConfig.getOptionalConfigArray('endpoints');
  if (!endpointsConfig) {
    return endpoints;
  }

  for (const endpointConfig of endpointsConfig) {
    const plugins = endpointConfig.getStringArray('plugins');
    const targetConfig = endpointConfig.getOptional('target');

    if (typeof targetConfig === 'string') {
      endpoints.push({ target: targetConfig, plugins });
    } else if (targetConfig && typeof targetConfig === 'object') {
      const target: { internal?: string; external?: string } = {};
      const targetObj = endpointConfig.getConfig('target');
      target.internal = targetObj.getOptionalString('internal');
      target.external = targetObj.getOptionalString('external');
      endpoints.push({ target, plugins });
    }
  }

  return endpoints;
}

type UrlResolver = (pluginId: string) => Promise<string>;

/**
 * Host-based discovery service implementation.
 * Resolves plugin URLs based on configuration.
 */
class HostDiscovery implements DiscoveryService {
  #internalResolvers: Map<string, UrlResolver> = new Map();
  #externalResolvers: Map<string, UrlResolver> = new Map();
  #internalFallbackResolver: UrlResolver = async () => {
    throw new Error('Not initialized');
  };
  #externalFallbackResolver: UrlResolver = async () => {
    throw new Error('Not initialized');
  };

  static fromConfig(
    config: RootConfigService,
    options?: { logger: LoggerService; defaultEndpoints?: DiscoveryEndpoint[] },
  ): HostDiscovery {
    const discovery = new HostDiscovery();
    discovery.#updateResolvers(config, options?.defaultEndpoints);
    config.subscribe?.(() => {
      try {
        discovery.#updateResolvers(config, options?.defaultEndpoints);
      } catch (e) {
        options?.logger.error(`Failed to update discovery service: ${e}`);
      }
    });
    return discovery;
  }

  async getBaseUrl(pluginId: string): Promise<string> {
    const resolver =
      this.#internalResolvers.get(pluginId) ??
      this.#internalResolvers.get('*') ??
      this.#internalFallbackResolver;
    return await resolver(pluginId);
  }

  async getExternalBaseUrl(pluginId: string): Promise<string> {
    const resolver =
      this.#externalResolvers.get(pluginId) ??
      this.#externalResolvers.get('*') ??
      this.#externalFallbackResolver;
    return await resolver(pluginId);
  }

  #updateResolvers(
    config: RootConfigService,
    defaultEndpoints?: DiscoveryEndpoint[],
  ): void {
    this.#updateFallbackResolvers(config);
    this.#updatePluginResolvers(config, defaultEndpoints);
  }

  #updateFallbackResolvers(config: RootConfigService): void {
    const backendBaseUrl = trimEnd(config.getString('backend.baseUrl'), '/');
    const {
      listen: { host: listenHost = '::', port: listenPort },
    } = readHttpServerOptions(config.getConfig('backend'));
    const protocol = config.has('backend.https') ? 'https' : 'http';

    let host = listenHost;
    if (host === '::' || host === '') {
      host = 'localhost';
    } else if (host === '0.0.0.0') {
      host = '127.0.0.1';
    }
    if (host.includes(':')) {
      host = `[${host}]`;
    }

    this.#internalFallbackResolver = this.#makeResolver(
      `${protocol}://${host}:${listenPort}/api/{{pluginId}}`,
    );
    this.#externalFallbackResolver = this.#makeResolver(
      `${backendBaseUrl}/api/{{pluginId}}`,
    );
  }

  #updatePluginResolvers(
    config: RootConfigService,
    defaultEndpoints?: DiscoveryEndpoint[],
  ): void {
    const endpoints = defaultEndpoints?.slice() ?? [];
    endpoints.push(...getEndpoints(config));

    const internalResolvers = new Map<string, UrlResolver>();
    const externalResolvers = new Map<string, UrlResolver>();

    for (const { target, plugins } of endpoints) {
      let internalResolver: UrlResolver | undefined;
      let externalResolver: UrlResolver | undefined;

      if (typeof target === 'string') {
        internalResolver = externalResolver = this.#makeResolver(target);
      } else {
        if (target.internal) {
          internalResolver = this.#makeResolver(target.internal);
        }
        if (target.external) {
          externalResolver = this.#makeResolver(target.external);
        }
      }

      if (internalResolver) {
        for (const pluginId of plugins) {
          internalResolvers.set(pluginId, internalResolver);
        }
      }
      if (externalResolver) {
        for (const pluginId of plugins) {
          externalResolvers.set(pluginId, externalResolver);
        }
      }
    }

    this.#internalResolvers = internalResolvers;
    this.#externalResolvers = externalResolvers;
  }

  #makeResolver(urlPattern: string): UrlResolver {
    return async (pluginId: string) => {
      return urlPattern.replace(
        /\{\{\s*pluginId\s*\}\}/g,
        encodeURIComponent(pluginId),
      );
    };
  }
}

/**
 * Discovery service factory.
 * Provides URL resolution for backend plugins.
 */
export const discoveryServiceFactory = createServiceFactory({
  service: coreServices.discovery,
  deps: {
    config: coreServices.rootConfig,
    logger: coreServices.logger,
  },
  async factory({ config, logger }) {
    return HostDiscovery.fromConfig(config, {
      logger,
      defaultEndpoints: [],
    });
  },
});
