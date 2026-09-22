import type { AuthSession } from './api/infrastructure';

export async function initAuth(
  _config: Record<string, unknown>,
  _redirectUri: string,
  _options?: Record<string, unknown>,
): Promise<AuthSession | null> {
  return null;
}
