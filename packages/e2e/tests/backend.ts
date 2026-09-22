import type { APIRequestContext } from '@playwright/test';

/**
 * Base URL for API-level test setup/cleanup. The frontend talks to
 * `config.backend.baseUrl` directly (not the Vite proxy), which is
 * http://localhost:7008 in both CI and local `yarn dev`. Set `BACKEND_URL` to
 * override. Reachability is checked once (and cached) so a spec fails with a
 * clear "is the backend running?" message instead of an opaque request error.
 */
const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:7008';

let cached: string | undefined;

export async function resolveBackendUrl(
  request: APIRequestContext,
): Promise<string> {
  if (cached) return cached;
  const res = await request
    .get(`${BACKEND_URL}/api/integrations/?limit=1`, { timeout: 3000 })
    .catch(() => null);
  if (!res?.ok()) {
    throw new Error(
      `Backend not reachable at ${BACKEND_URL}. Is it running? Set BACKEND_URL to override.`,
    );
  }
  cached = BACKEND_URL;
  return BACKEND_URL;
}
