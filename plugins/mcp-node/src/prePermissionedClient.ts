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
/**
 * Pre-permissioned fetch client that automatically includes authorization headers
 * for API calls within the MCP context
 */
export type PrePermissionedFetchClient = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createPrePermissionedFetchClient(
  token?: string,
  extraHeaders?: Record<string, string>,
): PrePermissionedFetchClient {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);

    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (extraHeaders) {
      for (const [key, value] of Object.entries(extraHeaders)) {
        if (!headers.has(key)) {
          headers.set(key, value);
        }
      }
    }

    // eslint-disable-next-line no-restricted-syntax -- pre-permissioned: the MCP session's token is resolved up front and attached above; this wrapper is the credential seam itself.
    return fetch(input, {
      ...init,
      headers,
    });
  };
}
