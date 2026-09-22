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
import type { Request } from 'express';

export const sanitizePath = (path: string): string => {
  return `/${path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')}`;
};

export const mcpHttpErrorStatus = (error: unknown): number => {
  if (typeof error !== 'object' || error === null) {
    return 500;
  }
  if ('name' in error && error.name === 'InputError') {
    return 400;
  }
  if ('name' in error && error.name === 'AuthenticationError') {
    return 401;
  }
  if ('name' in error && error.name === 'NotAllowedError') {
    return 403;
  }
  return 500;
};

// Only forward a well-formed bearer token. Validating the charset before it is
// baked into a generated shell/JS payload keeps a crafted Authorization header
// from injecting into the emitted install script.
const BEARER_RE = /^Bearer [A-Za-z0-9._~+/=-]+$/;

/**
 * The caller's Authorization header, forwarded into the generated telemetry
 * hooks so each POST is attributed to the right tenant. Returns undefined when
 * the header is absent or not a plain bearer token.
 */
export const forwardedAuthHeader = (req: Request): string | undefined => {
  const auth = req.headers.authorization;
  return typeof auth === 'string' && BEARER_RE.test(auth) ? auth : undefined;
};

/** ` -H "Authorization: Bearer …"` for a curl command, or '' when no token. */
export const curlAuthFlag = (token?: string): string =>
  token ? ` -H "Authorization: ${token}"` : '';

export const mcpAuthFlag = (token?: string): string =>
  token ? ` --header "Authorization: ${token}"` : '';
