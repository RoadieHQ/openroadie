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

import { SecretsSettingsApiClient } from './SecretsSettingsApiClient';

const discoveryApi = {
  async getBaseUrl(plugin: string) {
    return `http://roadie.tests/api/${plugin}`;
  },
};

const fetchApi = {
  async fetch(url: any): Promise<Response> {
    switch (url) {
      case 'http://roadie.tests/api/secrets-settings/keys':
        return {
          json: async () => {
            return [
              {
                shhh: 'secret',
              },
            ];
          },
          ok: true,
          statusText: 'Success',
        } as Response;
      default:
        throw new Error(`Not implemented: ${url}`);
    }
  },
};

describe('SecretsSettingsApiClient', () => {
  describe('#getKeys', () => {
    it('returns installations', async () => {
      const secretSetttingsApi = new SecretsSettingsApiClient({
        discoveryApi,
        fetchApi,
      });
      expect(await secretSetttingsApi.getKeys()).toEqual([
        {
          shhh: 'secret',
        },
      ]);
    });
  });
});
