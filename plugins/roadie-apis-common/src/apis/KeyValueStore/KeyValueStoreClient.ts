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
import { KeyValueStoreApi } from './KeyValueStoreApi';
import { DiscoveryApi, FetchApi } from '@roadiehq/core-plugin-api';
import { ResponseError } from '@roadiehq/errors';
import { JsonObject } from '@roadiehq/types';

export class KeyValueStoreClient implements KeyValueStoreApi {
  private readonly discoveryApi;
  private readonly fetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  async get<T = JsonObject>(key: string): Promise<T> {
    const keyValueStoreEndpoint = await this.discoveryApi.getBaseUrl('store');
    const response = await this.fetchApi.fetch(
      `${keyValueStoreEndpoint}/${key}`,
    );
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    const res = await response.json();
    return res.data;
  }

  async set<T = JsonObject>(key: string, data: T): Promise<boolean> {
    const keyValueStoreEndpoint = await this.discoveryApi.getBaseUrl('store');
    const response = await this.fetchApi.fetch(keyValueStoreEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key, data }),
    });
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return true;
  }
}
