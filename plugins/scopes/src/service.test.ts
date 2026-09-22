/*
 * Copyright 2026 Larder Software Limited
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
import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import { ALL_SCOPES, type GrantedScopes } from './checker';
import {
  createScopeService,
  resolveAllowedTargets,
  isTargetAllowed,
} from './service';

const req = {} as Request;

describe('resolveAllowedTargets', () => {
  const forScopes = (granted: GrantedScopes) =>
    createScopeService(() => granted);

  it('is undefined (no restriction) under the allow-all resolver', async () => {
    const svc = forScopes(ALL_SCOPES);
    expect(
      await resolveAllowedTargets(svc, req, 'action:query'),
    ).toBeUndefined();
  });

  it('is undefined when the un-narrowed scope is granted', async () => {
    const svc = forScopes(['action:query']);
    expect(
      await resolveAllowedTargets(svc, req, 'action:query'),
    ).toBeUndefined();
  });

  it('returns only the granted targets for a narrowed caller', async () => {
    const svc = forScopes([
      'action:query:create-shortcut-ticket',
      'action:query:create-repo',
      'action:execute:delete-repo', // different verb, not in this family
    ]);
    const targets = await resolveAllowedTargets(svc, req, 'action:query');
    expect(targets?.sort()).toEqual(['create-repo', 'create-shortcut-ticket']);
  });

  it('returns an empty list when nothing in the family is granted', async () => {
    const svc = forScopes(['capability:query']);
    expect(await resolveAllowedTargets(svc, req, 'action:query')).toEqual([]);
  });
});

describe('isTargetAllowed', () => {
  const forScopes = (granted: GrantedScopes) =>
    createScopeService(() => granted);

  it('allows any instance under the un-narrowed base grant', async () => {
    const svc = forScopes(['action:execute']);
    expect(
      await isTargetAllowed(svc, req, 'action:execute', ['id-1', 'slug-1']),
    ).toBe(true);
  });

  it('allows the instance when a narrowed grant matches any of its identifiers', async () => {
    // Grant is by slug; the request resolved the entity to [id, slug], so a
    // slug-form grant still authorizes an id-addressed request (and vice versa).
    const svc = forScopes(['action:execute:my-slug']);
    expect(
      await isTargetAllowed(svc, req, 'action:execute', [
        'uuid-123',
        'my-slug',
      ]),
    ).toBe(true);
  });

  it('denies an instance the narrowed grant does not cover', async () => {
    const svc = forScopes(['action:execute:other']);
    expect(
      await isTargetAllowed(svc, req, 'action:execute', [
        'uuid-123',
        'my-slug',
      ]),
    ).toBe(false);
  });

  it('allows everything under ALL_SCOPES', async () => {
    const svc = forScopes(ALL_SCOPES);
    expect(await isTargetAllowed(svc, req, 'action:execute', ['x'])).toBe(true);
  });
});
