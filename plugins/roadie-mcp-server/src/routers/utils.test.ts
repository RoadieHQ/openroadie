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
import {
  curlAuthFlag,
  forwardedAuthHeader,
  mcpHttpErrorStatus,
  mcpAuthFlag,
  sanitizePath,
} from './utils';

const reqWithAuth = (authorization?: string) =>
  ({ headers: authorization ? { authorization } : {} }) as unknown as Request;

describe('utils', () => {
  describe('mcpHttpErrorStatus', () => {
    it.each([
      ['InputError', 400],
      ['AuthenticationError', 401],
      ['NotAllowedError', 403],
      ['Error', 500],
    ])('maps %s to %s', (name, status) => {
      expect(mcpHttpErrorStatus({ name })).toBe(status);
    });
  });

  describe('forwardedAuthHeader', () => {
    it('returns a well-formed bearer header unchanged', () => {
      const token = 'Bearer eyJhbGc.iOiJ-SUzI1Ni_J9.abc-123_def';
      expect(forwardedAuthHeader(reqWithAuth(token))).toBe(token);
    });

    it('returns undefined when the header is absent', () => {
      expect(forwardedAuthHeader(reqWithAuth())).toBeUndefined();
    });

    it('rejects non-bearer schemes', () => {
      expect(forwardedAuthHeader(reqWithAuth('Basic abc123'))).toBeUndefined();
    });

    it('rejects tokens with shell/JS metacharacters (injection guard)', () => {
      expect(
        forwardedAuthHeader(reqWithAuth('Bearer abc"; rm -rf / #')),
      ).toBeUndefined();
      expect(
        forwardedAuthHeader(reqWithAuth('Bearer abc$(whoami)')),
      ).toBeUndefined();
    });
  });

  describe('curlAuthFlag', () => {
    it('builds an Authorization header flag when a token is present', () => {
      expect(curlAuthFlag('Bearer abc')).toBe(
        ' -H "Authorization: Bearer abc"',
      );
    });

    it('is empty when no token is present', () => {
      expect(curlAuthFlag()).toBe('');
      expect(curlAuthFlag(undefined)).toBe('');
    });
  });

  describe('mcpAuthFlag', () => {
    it('builds an Authorization header option when a token is present', () => {
      expect(mcpAuthFlag('Bearer abc')).toBe(
        ' --header "Authorization: Bearer abc"',
      );
    });

    it('is empty when no token is present', () => {
      expect(mcpAuthFlag()).toBe('');
    });
  });

  describe('path sanitization logic', () => {
    it('should remove leading slashes and add single leading slash', () => {
      expect(sanitizePath('//test/path')).toBe('/test/path');
      expect(sanitizePath('///test/path')).toBe('/test/path');
      expect(sanitizePath('test/path')).toBe('/test/path');
    });

    it('should remove trailing slashes', () => {
      expect(sanitizePath('test/path//')).toBe('/test/path');
      expect(sanitizePath('test/path///')).toBe('/test/path');
      expect(sanitizePath('test/path/')).toBe('/test/path');
    });

    it('should replace consecutive slashes with single slash', () => {
      expect(sanitizePath('test//path')).toBe('/test/path');
      expect(sanitizePath('test///path')).toBe('/test/path');
      expect(sanitizePath('test////path')).toBe('/test/path');
    });

    it('should handle complex combinations', () => {
      expect(sanitizePath('//test///path//resource//')).toBe(
        '/test/path/resource',
      );
      expect(sanitizePath('///api//v1///mcp///')).toBe('/api/v1/mcp');
    });

    it('should handle edge cases', () => {
      expect(sanitizePath('')).toBe('/');
      expect(sanitizePath('/')).toBe('/');
      expect(sanitizePath('//')).toBe('/');
      expect(sanitizePath('///')).toBe('/');
    });

    it('should preserve single path segments', () => {
      expect(sanitizePath('test')).toBe('/test');
      expect(sanitizePath('/test')).toBe('/test');
      expect(sanitizePath('test/')).toBe('/test');
      expect(sanitizePath('/test/')).toBe('/test');
    });
  });
});
