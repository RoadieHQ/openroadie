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

import { GitHubAppSupportApiClient } from './GitHubAppSupportApiClient';

const discoveryApi = {
  async getBaseUrl(plugin: string) {
    return `http://roadie.tests/api/${plugin}`;
  },
};

let fetchApi = {
  async fetch(url: any, options: any): Promise<Response> {
    if (options?.method === 'POST') {
      if (url === 'http://roadie.tests/api/github-app-support/installations') {
        return {
          json: async () => {
            return {};
          },
          status: 201,
          statusText: 'Success',
        } as Response;
      }
      throw new Error(`Not implemented: POST ${url}`);
    }
    switch (url) {
      case 'http://roadie.tests/api/github-app-support/active':
        return {
          json: async () => {
            return {
              isActive: true,
            };
          },
          ok: true,
          statusText: 'Success',
        } as Response;
      case 'http://roadie.tests/api/github-app-support/enabled':
        return {
          json: async () => {
            return {
              enabled: true,
            };
          },
          ok: true,
          statusText: 'Success',
        } as Response;
      case 'http://roadie.tests/api/github-app-support/installations':
        return {
          json: async () => {
            return {
              installations: [
                {
                  avatar: 'https://asdf',
                  organization: 'asdf',
                  organization_url: 'https://github.com/asdf',
                  active: true,
                },
              ],
            };
          },
          ok: true,
          statusText: 'Success',
        } as Response;
      case 'http://roadie.tests/api/github-app-support/installation-link':
        return {
          json: async () => {
            return {
              app_installation_url: 'https://github.com/app/installation',
            };
          },
          ok: true,
          statusText: 'Success',
        } as Response;
      default:
        throw new Error(`Not implemented: ${url}`);
    }
  },
};

describe('GitHubAppSupportApiClient', () => {
  describe('#isActive', () => {
    it('returns active status', async () => {
      const gitHubAppSupportApi = new GitHubAppSupportApiClient({
        discoveryApi,
        fetchApi,
      });
      expect(await gitHubAppSupportApi.isActive()).toEqual(true);
    });
  });

  describe('#isEnabled', () => {
    it('returns enabled status', async () => {
      const gitHubAppSupportApi = new GitHubAppSupportApiClient({
        discoveryApi,
        fetchApi,
      });
      expect(await gitHubAppSupportApi.isEnabled()).toEqual(true);
    });
  });

  describe('#getInstallations', () => {
    it('returns installations', async () => {
      const gitHubAppSupportApi = new GitHubAppSupportApiClient({
        discoveryApi,
        fetchApi,
      });
      expect(await gitHubAppSupportApi.getInstallations()).toEqual([
        {
          avatar: 'https://asdf',
          organization: 'asdf',
          organization_url: 'https://github.com/asdf',
          active: true,
        },
      ]);
    });
  });

  describe('#hasInstallations', () => {
    it('returns whether there are installations', async () => {
      const gitHubAppSupportApi = new GitHubAppSupportApiClient({
        discoveryApi,
        fetchApi,
      });
      expect(await gitHubAppSupportApi.hasInstallations()).toEqual(true);
    });
  });

  describe('#getInstallationLink', () => {
    it('returns the app installation link', async () => {
      const gitHubAppSupportApi = new GitHubAppSupportApiClient({
        discoveryApi,
        fetchApi,
      });
      expect(await gitHubAppSupportApi.getInstallationLink()).toEqual(
        'https://github.com/app/installation',
      );
    });
  });

  describe('#addInstallation', () => {
    it('allows creating installations', async () => {
      const gitHubAppSupportApi = new GitHubAppSupportApiClient({
        discoveryApi,
        fetchApi,
      });
      expect(await gitHubAppSupportApi.addInstallation('')).toEqual(undefined);
    });

    describe('where there is a 500 error from the installations api', () => {
      beforeEach(() => {
        fetchApi = {
          async fetch(url: any, options: any): Promise<Response> {
            if (options?.method === 'POST') {
              if (
                url ===
                'http://roadie.tests/api/github-app-support/installations'
              ) {
                return {
                  json: async () => {
                    return {};
                  },
                  ok: false,
                  status: 500,
                  statusText: 'Success',
                } as Response;
              }
            }
            throw new Error(`Not implemented: ${url}`);
          },
        };
      });

      it('throws an error', async () => {
        const gitHubAppSupportApi = new GitHubAppSupportApiClient({
          discoveryApi,
          fetchApi,
        });
        await expect(gitHubAppSupportApi.addInstallation('')).rejects.toEqual(
          new Error('Github app not configured. Please contact your support.'),
        );
      });
    });

    describe('where there is a 400 error from the installations api', () => {
      beforeEach(() => {
        fetchApi = {
          async fetch(url: any, options: any): Promise<Response> {
            if (options?.method === 'POST') {
              if (
                url ===
                'http://roadie.tests/api/github-app-support/installations'
              ) {
                return {
                  json: async () => {
                    return {};
                  },
                  ok: false,
                  status: 400,
                  statusText: 'Success',
                } as Response;
              }
            }
            throw new Error(`Not implemented: ${url}`);
          },
        };
      });

      it('throws an error', async () => {
        const gitHubAppSupportApi = new GitHubAppSupportApiClient({
          discoveryApi,
          fetchApi,
        });
        await expect(gitHubAppSupportApi.addInstallation('')).rejects.toEqual(
          new Error(
            'There was an issue with the installation of your app. Please contact your support.',
          ),
        );
      });
    });
  });
});
