import type { AuthType } from './types';

export function authLabel(authType: AuthType) {
  if (authType === 'none') {
    return 'managed';
  }
  if (authType === 'header' || authType === 'bearer-token') {
    return 'token';
  }
  if (authType === 'basic') {
    return 'basic';
  }
  if (authType === 'github-app') {
    return 'app install';
  }
  if (authType === 'oauth2-jwt-bearer') {
    return 'oauth jwt';
  }
  return 'oauth';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
