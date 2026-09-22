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
import { describe, it, expect } from 'vitest';
import { ALL_SCOPES, createScopeChecker } from './checker';
import { SCOPES, scope } from '@roadiehq/scopes-common';

describe('createScopeChecker', () => {
  describe('allow-all', () => {
    const checker = createScopeChecker(ALL_SCOPES);

    it('allows any scope', () => {
      expect(checker.allows('action:execute')).toBe(true);
      expect(checker.allows('anything:at:all')).toBe(true);
    });

    it('allows any family', () => {
      expect(checker.allowsFamily('action:execute')).toBe(true);
    });
  });

  describe('explicit grants', () => {
    it('allows an exact scope', () => {
      const checker = createScopeChecker([SCOPES.action.query]);
      expect(checker.allows('action:query')).toBe(true);
      expect(checker.allows('action:execute')).toBe(false);
    });

    it('treats an un-narrowed grant as covering every target', () => {
      const checker = createScopeChecker([SCOPES.action.execute]);
      expect(checker.allows('action:execute')).toBe(true);
      expect(checker.allows(scope('action', 'execute', 'action-1'))).toBe(true);
      expect(checker.allows(scope('action', 'execute', 'action-2'))).toBe(true);
    });

    it('confines a narrowed grant to its target', () => {
      const checker = createScopeChecker([
        scope('action', 'execute', 'action-1'),
      ]);
      expect(checker.allows(scope('action', 'execute', 'action-1'))).toBe(true);
      expect(checker.allows(scope('action', 'execute', 'action-2'))).toBe(
        false,
      );
      // Holding only a narrowed grant does not grant the un-narrowed scope.
      expect(checker.allows('action:execute')).toBe(false);
    });
  });

  describe('allowsFamily (tool listing)', () => {
    it('is true when the base scope is granted', () => {
      const checker = createScopeChecker([SCOPES.action.execute]);
      expect(checker.allowsFamily('action:execute')).toBe(true);
    });

    it('is true when only a narrowed target is granted', () => {
      const checker = createScopeChecker([
        scope('action', 'execute', 'action-1'),
      ]);
      expect(checker.allowsFamily('action:execute')).toBe(true);
    });

    it('is false when nothing in the family is granted', () => {
      const checker = createScopeChecker([SCOPES.action.query]);
      expect(checker.allowsFamily('action:execute')).toBe(false);
    });
  });

  describe('allowedTargets (row filtering)', () => {
    it('is ALL_SCOPES under allow-all (no restriction)', () => {
      const checker = createScopeChecker(ALL_SCOPES);
      expect(checker.allowedTargets('action:query')).toBe(ALL_SCOPES);
    });

    it('is ALL_SCOPES when the un-narrowed scope is granted', () => {
      const checker = createScopeChecker([SCOPES.action.query]);
      expect(checker.allowedTargets('action:query')).toBe(ALL_SCOPES);
    });

    it('returns just the granted targets when only narrowed grants are held', () => {
      const checker = createScopeChecker([
        scope('action', 'query', 'create-shortcut-ticket'),
        scope('action', 'query', 'create-repo'),
        // A different verb in the same resource is not part of this family.
        scope('action', 'execute', 'delete-repo'),
      ]);
      expect(checker.allowedTargets('action:query')).toEqual(
        new Set(['create-shortcut-ticket', 'create-repo']),
      );
    });

    it('returns an empty set when nothing in the family is granted', () => {
      const checker = createScopeChecker([SCOPES.capability.query]);
      expect(checker.allowedTargets('action:query')).toEqual(new Set());
    });
  });
});
