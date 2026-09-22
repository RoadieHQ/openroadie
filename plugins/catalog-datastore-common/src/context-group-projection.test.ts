/*
 * Copyright 2026 Larder Software Ltd.
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
import { applyProjection } from './context-group-projection';

describe('applyProjection', () => {
  const object = {
    name: 'Ada',
    metadata: { role: 'admin', team: { id: 't1' } },
    secret: 'do-not-leak',
  };

  it('returns the full object when projection is absent or empty', () => {
    expect(applyProjection(object)).toBe(object);
    expect(applyProjection(object, [])).toBe(object);
  });

  it('maps dot-path sources to labeled keys', () => {
    expect(
      applyProjection(object, [
        { source: 'name', label: 'name' },
        { source: 'metadata.role', label: 'role' },
        { source: 'metadata.team.id', label: 'teamId' },
      ]),
    ).toEqual({ name: 'Ada', role: 'admin', teamId: 't1' });
  });

  it('drops fields not selected by the projection', () => {
    const projected = applyProjection(object, [
      { source: 'name', label: 'name' },
    ]) as Record<string, unknown>;
    expect(projected).toEqual({ name: 'Ada' });
    expect(projected.secret).toBeUndefined();
  });

  it('yields undefined for a missing path', () => {
    expect(
      applyProjection(object, [{ source: 'metadata.missing', label: 'x' }]),
    ).toEqual({ x: undefined });
  });

  it('skips mappings missing a source or label', () => {
    expect(
      applyProjection(object, [
        { source: '', label: 'x' },
        { source: 'name', label: '' },
        { source: 'name', label: 'name' },
      ]),
    ).toEqual({ name: 'Ada' });
  });

  it('treats a bare FieldMapping array as include mode (legacy shape)', () => {
    expect(
      applyProjection(object, [{ source: 'name', label: 'name' }]),
    ).toEqual({ name: 'Ada' });
  });

  it('applies an explicit include-mode projection', () => {
    expect(
      applyProjection(object, {
        mode: 'include',
        fields: [{ source: 'metadata.role', label: 'role' }],
      }),
    ).toEqual({ role: 'admin' });
    expect(applyProjection(object, { mode: 'include', fields: [] })).toBe(
      object,
    );
  });

  describe('exclude mode', () => {
    it('removes the listed paths and keeps the rest with original keys', () => {
      expect(
        applyProjection(object, { mode: 'exclude', paths: ['secret'] }),
      ).toEqual({
        name: 'Ada',
        metadata: { role: 'admin', team: { id: 't1' } },
      });
    });

    it('removes nested paths without touching siblings', () => {
      expect(
        applyProjection(object, {
          mode: 'exclude',
          paths: ['metadata.team.id'],
        }),
      ).toEqual({
        name: 'Ada',
        metadata: { role: 'admin', team: {} },
        secret: 'do-not-leak',
      });
    });

    it('does not mutate the original object', () => {
      const original = { a: 1, b: 2 };
      applyProjection(original, { mode: 'exclude', paths: ['b'] });
      expect(original).toEqual({ a: 1, b: 2 });
    });

    it('returns the object unchanged for an empty path list', () => {
      expect(applyProjection(object, { mode: 'exclude', paths: [] })).toBe(
        object,
      );
    });
  });
});
