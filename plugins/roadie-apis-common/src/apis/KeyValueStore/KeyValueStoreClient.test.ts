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

import { KeyValueStoreClient } from './KeyValueStoreClient';

const discoveryApi = {
  async getBaseUrl(plugin: string) {
    return `http://roadie.tests/api/${plugin}`;
  },
};

const fetchApi = {
  async fetch(url: any, options: any): Promise<Response> {
    switch (url) {
      case 'http://roadie.tests/api/store':
        if (options.method !== 'POST') {
          throw new Error(`Not implemented: ${url}`);
        }

        return {
          json: async () => {
            return {};
          },
          ok: true,
          status: 201,
          statusText: 'Success',
        } as Response;
      case 'http://roadie.tests/api/store/mydata':
        return {
          json: async () => {
            return { data: { hello: 'world' } };
          },
          ok: true,
          status: 200,
          statusText: 'Success',
        } as Response;
      default:
        throw new Error(`Not implemented: ${url}`);
    }
  },
};

describe('KeyValueStoreClient', () => {
  describe('#set', () => {
    it('should return true when successfully sets data to the store', async () => {
      const keyValueStoreClient = new KeyValueStoreClient({
        discoveryApi,
        fetchApi,
      });
      expect(
        await keyValueStoreClient.set<{ hello: string }>('mydata', {
          hello: 'world',
        }),
      ).toEqual(true);
    });
  });

  describe('#get', () => {
    it('returns active status', async () => {
      const keyValueStoreClient = new KeyValueStoreClient({
        discoveryApi,
        fetchApi,
      });
      expect(
        await keyValueStoreClient.get<{ hello: string }>('mydata'),
      ).toEqual({
        hello: 'world',
      });
    });
  });
});
