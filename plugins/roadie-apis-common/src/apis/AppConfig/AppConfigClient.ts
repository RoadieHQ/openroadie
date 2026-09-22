/*
 * Copyright 2022 Larder Software Ltd.
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
import { AppConfigApi } from './AppConfigApi';
import { DiscoveryApi, FetchApi } from '@roadiehq/core-plugin-api';
import { ResponseError } from '@roadiehq/errors';
import { AppConfigSection } from './types';

export class AppConfigClient implements AppConfigApi {
  private readonly discoveryApi;
  private readonly fetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  async verifyAwsRole(opts: {
    assumeRole: string;
    externalId: string;
    region?: string;
  }) {
    const appConfigEndpoint = await this.discoveryApi.getBaseUrl('app-config');
    const response = await this.fetchApi.fetch(
      `${appConfigEndpoint}/verify-aws-role`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
        body: JSON.stringify(opts),
      },
    );
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(
        `Call to /api/app-config/verify-aws-role failed with response ${response.status}: ${payload}`,
      );
    }
    return await response.json();
  }

  async listProxies() {
    const appConfigEndpoint = await this.discoveryApi.getBaseUrl('app-config');
    const response = await this.fetchApi.fetch(`${appConfigEndpoint}/ui/proxy`);
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(
        `Call to /api/app-config/ui/proxy failed with response ${response.status}: ${payload}`,
      );
    }
    const payload = await response.json();
    const mergedProxies = payload[0].data.proxy
      ? payload[0].data.defaultProxy.concat(payload[0].data.proxy)
      : payload[0].data.defaultProxy;

    return mergedProxies;
  }

  async stopBackend() {
    const appConfigEndpoint = await this.discoveryApi.getBaseUrl('app-config');
    const response = await this.fetchApi.fetch(
      `${appConfigEndpoint}/stop-backend`,
      {
        method: 'POST',
      },
    );

    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
  }

  async getAppConfigSectionsForUi(): Promise<AppConfigSection[]> {
    const appConfigEndpoint = await this.discoveryApi.getBaseUrl('app-config');
    const response = await this.fetchApi.fetch(`${appConfigEndpoint}/ui`);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return await response.json();
  }

  async getAppConfigSection(name: string): Promise<AppConfigSection[]> {
    const appConfigEndpoint = await this.discoveryApi.getBaseUrl('app-config');
    const response = await this.fetchApi.fetch(
      `${appConfigEndpoint}/ui/${name}`,
    );
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return await response.json();
  }

  async writeConfiguration(
    section: Omit<AppConfigSection, 'schema'>,
  ): Promise<void> {
    const appConfigEndpoint = await this.discoveryApi.getBaseUrl('app-config');
    const response = await this.fetchApi.fetch(
      `${appConfigEndpoint}/${section.id}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
        body: JSON.stringify(section.data),
      },
    );
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
  }

  async checkIntegrationStatus(integration: string): Promise<boolean> {
    const appConfigEndpoint = await this.discoveryApi.getBaseUrl('app-config');
    const response = await this.fetchApi.fetch(
      `${appConfigEndpoint}/isActive/${integration}`,
    );
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return await response.json();
  }
}
