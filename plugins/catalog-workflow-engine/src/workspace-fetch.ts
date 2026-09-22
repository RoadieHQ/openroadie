import type { InternalFetchApi } from '@roadiehq/extensions-api';

const WORKSPACE_ID_HEADER = 'x-openroadie-workspace-id';

export function withWorkspaceFetch(
  fetchApi: InternalFetchApi,
  workspaceId: string | undefined,
): InternalFetchApi {
  if (!workspaceId) {
    return fetchApi;
  }

  return {
    fetch: async (input, init) => {
      const headers = new Headers(
        init?.headers ??
          (typeof input === 'object' && !(input instanceof URL)
            ? input.headers
            : undefined),
      );
      headers.set(WORKSPACE_ID_HEADER, workspaceId);
      return fetchApi.fetch(input, { ...init, headers });
    },
  };
}
