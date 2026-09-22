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

import { SecretMetadata, SecretsSettingsApi } from './SecretsSettingsApi';
import { DiscoveryApi, FetchApi } from '@roadiehq/core-plugin-api';
import { Secret } from './types';

export class SecretsSettingsApiClient implements SecretsSettingsApi {
  private discoveryApi: DiscoveryApi;
  private fetchApi: FetchApi;
  private baseUrl?: string;

  constructor({
    discoveryApi,
    fetchApi,
  }: {
    discoveryApi: DiscoveryApi;
    fetchApi: FetchApi;
  }) {
    this.discoveryApi = discoveryApi;
    this.fetchApi = fetchApi;
  }

  private async getBaseUrl(): Promise<string> {
    if (!this.baseUrl) {
      this.baseUrl = await this.discoveryApi.getBaseUrl('secrets-settings');
    }
    return this.baseUrl;
  }

  async getKeys() {
    const response = await this.fetchApi.fetch(
      `${await this.getBaseUrl()}/keys`,
    );
    if (!response.ok) {
      const errorMsg =
        'Failed to retrieve keys for secrets. Is the the plugin backend configured properly?';
      throw new Error(
        `${errorMsg}. Status: ${response.status} (${response.statusText})`,
      );
    }
    return await response.json();
  }

  async getMetadata(): Promise<SecretMetadata[]> {
    const response = await this.fetchApi.fetch(
      `${await this.getBaseUrl()}/secret-metadata`,
    );
    if (!response.ok) {
      const errorMsg = 'Failed to retrieve secret metadata.';
      throw new Error(
        `${errorMsg}. Status: ${response.status} (${response.statusText})`,
      );
    }
    return await response.json();
  }

  async getSecret(secret: string): Promise<Secret> {
    const response = await this.fetchApi.fetch(
      `${await this.getBaseUrl()}/secret-value/${secret}?buster=${new Date().getMilliseconds()}`,
    );
    if (!response.ok) {
      const errorMsg = 'Failed to retrieve secret info.';
      throw new Error(
        `${errorMsg}. Status: ${response.status} (${response.statusText})`,
      );
    }
    return await response.json();
  }

  async deleteSecret(secret: string): Promise<void> {
    const response = await this.fetchApi.fetch(
      `${await this.getBaseUrl()}/secret-value/${secret}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      const errorMsg = 'Failed to delete secret.';
      throw new Error(
        `${errorMsg}. Status: ${response.status} (${response.statusText})`,
      );
    }
  }

  async deleteSecretMetadata(name: string): Promise<void> {
    const response = await this.fetchApi.fetch(
      `${await this.getBaseUrl()}/secret-metadata/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      const errorMsg = 'Failed to delete secret metadata.';
      throw new Error(
        `${errorMsg}. Status: ${response.status} (${response.statusText})`,
      );
    }
  }

  async setSecret(name: string, value: string): Promise<void> {
    const response = await this.fetchApi.fetch(
      `${await this.getBaseUrl()}/keys`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: name, value: value.trim() }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Unable to save secret. Server responded ${response.status}`,
      );
    }
  }

  async addSecret({
    name,
    description,
    helpUrl,
    internalKeyName,
  }: {
    name: string;
    description?: string;
    helpUrl?: string;
    internalKeyName?: string;
  }): Promise<void> {
    const response = await this.fetchApi.fetch(
      `${await this.getBaseUrl()}/secret-metadata`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, description, helpUrl, internalKeyName }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Unable to save secret. Server responded ${response.status}`,
      );
    }
  }

  async editSecret(
    name: string,
    patch: {
      description?: string | null;
      helpUrl?: string | null;
      name?: string;
      internalKeyName?: string;
    },
  ): Promise<void> {
    const response = await this.fetchApi.fetch(
      `${await this.getBaseUrl()}/secret-metadata/${encodeURIComponent(name)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Unable to edit secret metadata. Server responded ${response.status}`,
      );
    }
  }

  async getStorageMode(): Promise<{
    mode: 'env' | 'dotenv' | 'scoped';
    readOnly: boolean;
    dotenvPath?: string;
  }> {
    const response = await this.fetchApi.fetch(
      `${await this.getBaseUrl()}/storage-mode`,
    );
    if (!response.ok) {
      throw new Error(
        `Failed to load secret store mode. Status: ${response.status} (${response.statusText})`,
      );
    }
    return response.json();
  }

  async getSecretStatus(ref: string): Promise<{ exists: boolean }> {
    const response = await this.fetchApi.fetch(
      `${await this.getBaseUrl()}/secret-status/${encodeURIComponent(ref)}`,
    );
    if (!response.ok) {
      throw new Error(
        `Failed to load secret status. Status: ${response.status} (${response.statusText})`,
      );
    }
    return response.json();
  }
}
