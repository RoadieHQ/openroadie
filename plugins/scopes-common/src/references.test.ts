/*
 * Copyright 2025 Larder Software Limited
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

import { describe, expect, it } from 'vitest';
import {
  extractReferences,
  isValidSlug,
  referenceKey,
  rewriteReferences,
  REFERENCE_TOKEN_SOURCE,
  SLUG_RE,
  SLUG_SOURCE,
} from './references';

describe('extractReferences', () => {
  it('returns nothing for empty or reference-free text', () => {
    expect(extractReferences('')).toEqual([]);
    expect(extractReferences('no references here')).toEqual([]);
  });

  it('extracts every reference type', () => {
    const refs = extractReferences(
      'Use @capability:deploy-service and @action:create-repo, ' +
        'reading @context-group:payments-team from @datasource:sentry-projects.',
    );
    expect(refs).toEqual([
      { type: 'capability', slug: 'deploy-service' },
      { type: 'action', slug: 'create-repo' },
      { type: 'context-group', slug: 'payments-team' },
      { type: 'datasource', slug: 'sentry-projects' },
    ]);
  });

  it('de-duplicates by type:slug', () => {
    const refs = extractReferences('@action:a @action:a @action:b');
    expect(refs).toEqual([
      { type: 'action', slug: 'a' },
      { type: 'action', slug: 'b' },
    ]);
  });

  it('ignores unknown types and malformed slugs', () => {
    expect(extractReferences('@widget:foo @action:Bad_Slug @action:')).toEqual(
      [],
    );
  });

  it('builds a stable lookup key', () => {
    expect(referenceKey('capability', 'deploy-service')).toBe(
      'capability:deploy-service',
    );
  });
});

describe('SLUG_RE', () => {
  it.each(['a', 'a1', 'a-b', 'a1-2b', 'sentry-projects'])(
    'accepts %s',
    slug => {
      expect(isValidSlug(slug)).toBe(true);
    },
  );

  it.each(['', '-a', 'a-', 'a--b', 'My_Group', 'Foo', 'a b', 'a.b', '-'])(
    'rejects %s',
    slug => {
      expect(isValidSlug(slug)).toBe(false);
    },
  );

  it('is stateless — no global flag, so repeated tests agree', () => {
    expect(SLUG_RE.flags).toBe('');
    expect(SLUG_RE.test('a-b')).toBe(true);
    expect(SLUG_RE.test('a-b')).toBe(true);
  });

  it('cannot drift from the token grammar', () => {
    expect(REFERENCE_TOKEN_SOURCE).toContain(SLUG_SOURCE);
  });

  it('accepts exactly the slugs a token can carry whole', () => {
    // The token regex is unanchored, so `@action:a-` still matches the prefix
    // `a`. A slug is referenceable only when the capture is the *whole* string.
    for (const slug of ['ok', 'a-b-c', 'a1', '', '-a', 'a-', 'a--b', 'A']) {
      expect(isValidSlug(slug)).toBe(
        extractReferences(`@action:${slug}`)[0]?.slug === slug,
      );
    }
  });
});

describe('rewriteReferences', () => {
  it('rewrites every occurrence of the matching token', () => {
    expect(
      rewriteReferences(
        'Read @datasource:foo then @datasource:foo again.',
        'datasource',
        'foo',
        'bar',
      ),
    ).toBe('Read @datasource:bar then @datasource:bar again.');
  });

  it('leaves a longer slug sharing the prefix untouched', () => {
    // The whole reason this goes through the token regex: a substring replace
    // would turn `@datasource:foo-bar` into `@datasource:new-bar`.
    expect(
      rewriteReferences(
        '@datasource:foo and @datasource:foo-bar',
        'datasource',
        'foo',
        'new',
      ),
    ).toBe('@datasource:new and @datasource:foo-bar');
  });

  it('leaves the same slug under a different type untouched', () => {
    expect(
      rewriteReferences(
        '@action:foo @datasource:foo',
        'datasource',
        'foo',
        'x',
      ),
    ).toBe('@action:foo @datasource:x');
  });

  it('inserts a replacement containing $ patterns literally', () => {
    // `$&` / `$1` would be capture-group references under a string replacement.
    expect(rewriteReferences('@action:a', 'action', 'a', 'b$&c')).toBe(
      '@action:b$&c',
    );
    expect(rewriteReferences('@action:a', 'action', 'a', '$1')).toBe(
      '@action:$1',
    );
  });

  it('returns the input by identity when nothing matches', () => {
    const text = '@action:other';
    expect(rewriteReferences(text, 'datasource', 'foo', 'bar')).toBe(text);
  });

  it('is a no-op for an empty, unchanged or absent slug', () => {
    expect(rewriteReferences('', 'action', 'a', 'b')).toBe('');
    expect(rewriteReferences('@action:a', 'action', 'a', 'a')).toBe(
      '@action:a',
    );
    expect(rewriteReferences('@action:a', 'action', '', 'b')).toBe('@action:a');
  });
});
