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
import { DiscoveryApi, FetchApi } from '@roadiehq/core-plugin-api';
import { SingleSignOnApi } from './SingleSignOnApi';
import { ResponseError } from '@roadiehq/errors';
import { TTlCache } from '../TTlCache';

const identityCache = new TTlCache<unknown>();
export class SingleSignOnClient implements SingleSignOnApi {
  private readonly discoveryApi;
  private readonly fetchApi;

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchApi = options.fetchApi;
  }

  async getIdentity({ token }: { token: string }): Promise<unknown> {
    return await identityCache.get(token, async () => {
      const singleSignOnEndpoint =
        await this.discoveryApi.getBaseUrl('single-sign-on');

      const response = await this.fetchApi.fetch(
        `${singleSignOnEndpoint}/identity`,
        {
          headers: {
            authorization: `Bearer ${token}`,
          },
        },
      );
      if (!response.ok) {
        throw await ResponseError.fromResponse(response);
      }
      const identity = await response.json();
      return identity;
    });
  }
}
