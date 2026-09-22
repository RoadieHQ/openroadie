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

import {
  GitHubAppSupportApi,
  GitHubAppInstallation,
} from './GitHubAppSupportApi';
import { DiscoveryApi, FetchApi } from '@roadiehq/core-plugin-api';

export class GitHubAppSupportApiClient implements GitHubAppSupportApi {
  private discoveryApi: DiscoveryApi;
  private fetchApi: FetchApi;
  private baseUrl?: string;
  private installationLink?: string;

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
      this.baseUrl = await this.discoveryApi.getBaseUrl('github-app-support');
    }
    return this.baseUrl;
  }

  async getInstallations(): Promise<GitHubAppInstallation[]> {
    const baseUrl = await this.getBaseUrl();
    const response = await this.fetchApi.fetch(`${baseUrl}/installations`);
    if (response.ok) {
      return (await response.json()).installations;
    }
    throw new Error(
      `Failed to retrieve installations from API: ${response.statusText}`,
    );
  }

  async hasInstallations(): Promise<boolean> {
    return (await this.getInstallations()).length > 0;
  }

  async getInstallationLink(): Promise<string> {
    if (this.installationLink) {
      return this.installationLink;
    }
    const baseUrl = await this.getBaseUrl();
    const response = await this.fetchApi.fetch(`${baseUrl}/installation-link`);
    if (response.ok) {
      this.installationLink = (await response.json())
        .app_installation_url as string;
      return this.installationLink;
    }
    throw new Error(
      `Failed to retrieve installation-link from API: ${response.statusText}`,
    );
  }

  async isEnabled(): Promise<boolean> {
    const baseUrl = await this.getBaseUrl();
    const response = await this.fetchApi.fetch(`${baseUrl}/enabled`);
    if (response.ok) {
      return (await response.json()).enabled;
    }
    throw new Error(
      `Failed to retrieve enabled from API: ${response.statusText}`,
    );
  }

  async isActive(): Promise<boolean> {
    const baseUrl = await this.getBaseUrl();
    const response = await this.fetchApi.fetch(`${baseUrl}/active`);
    if (response.ok) {
      return (await response.json()).isActive;
    }
    throw new Error(
      `Failed to retrieve active from API: ${response.statusText}`,
    );
  }

  async addInstallation(queryString: string): Promise<undefined> {
    const baseUrl = await this.getBaseUrl();

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
      },
    };

    const response = await this.fetchApi.fetch(
      `${baseUrl}/installations${queryString}`,
      options,
    );

    if (response.status >= 500 && response.status <= 599) {
      throw new Error(
        'Github app not configured. Please contact your support.',
      );
    } else if (response.status >= 400 && response.status <= 499) {
      throw new Error(
        'There was an issue with the installation of your app. Please contact your support.',
      );
    }

    return undefined;
  }
}
