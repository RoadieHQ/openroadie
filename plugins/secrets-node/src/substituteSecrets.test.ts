/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it, vi } from 'vitest';

import { substituteSecrets, extractSecretRefs } from './substituteSecrets';
import type { SecretResolver } from './secretStore';

function fakeResolver(values: Record<string, string>): SecretResolver {
  return {
    async resolve(refs) {
      const out: Record<string, string> = {};
      for (const ref of refs) {
        if (values[ref] !== undefined) {
          out[ref] = values[ref];
        }
      }
      return out;
    },
  };
}

describe('extractSecretRefs', () => {
  it('returns a distinct list of refs', () => {
    expect(extractSecretRefs('Bearer ${A} extra ${B} again ${A}')).toEqual([
      'A',
      'B',
    ]);
  });

  it('returns an empty list when no refs are present', () => {
    expect(extractSecretRefs('plain string')).toEqual([]);
  });
});

describe('substituteSecrets', () => {
  it('returns the string untouched when there are no placeholders', async () => {
    const resolver = fakeResolver({ A: 'x' });
    expect(await substituteSecrets('hello', resolver, new Set(['A']))).toBe(
      'hello',
    );
  });

  it('substitutes all refs in a single resolve call', async () => {
    const resolver = fakeResolver({ A: 'alpha', B: 'beta' });
    const spy = vi.spyOn(resolver, 'resolve');
    const out = await substituteSecrets(
      'Bearer ${A} and ${B}',
      resolver,
      new Set(['A', 'B']),
    );
    expect(out).toBe('Bearer alpha and beta');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('rejects refs not in the allowlist', async () => {
    const resolver = fakeResolver({ A: 'x' });
    await expect(
      substituteSecrets('${A}', resolver, new Set()),
    ).rejects.toThrow('Secret substitution not permitted');
  });

  it('throws when a permitted ref is missing', async () => {
    const resolver = fakeResolver({});
    await expect(
      substituteSecrets('${A}', resolver, new Set(['A'])),
    ).rejects.toThrow('Referenced secret is not set');
  });
});
