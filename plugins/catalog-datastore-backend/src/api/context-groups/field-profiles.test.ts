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
import { describe, it, expect } from 'vitest';
import { computeProjectionFieldProfiles } from './field-profiles';

describe('computeProjectionFieldProfiles', () => {
  const objects = [
    {
      id: 'u1',
      login: 'ada',
      name: 'Ada Lovelace',
      status: 'active',
      bio: 'Mathematician and writer, the first programmer, worked on the Analytical Engine.',
      secret: 'token-1',
    },
    {
      id: 'u2',
      login: 'bob',
      name: 'Bob Smith',
      status: 'inactive',
      bio: 'Another long biography string that varies per row and is high cardinality.',
      secret: 'token-2',
    },
    {
      id: 'u3',
      login: 'cara',
      name: 'Cara Jones',
      status: 'active',
      bio: 'Yet another distinct biography value for the third row of the sample set.',
      secret: 'token-3',
    },
  ];

  it('lists the datasource fields', () => {
    const { fields } = computeProjectionFieldProfiles(objects);
    const paths = fields.map(f => f.path);
    expect(paths).toEqual(
      expect.arrayContaining(['id', 'login', 'name', 'status', 'bio']),
    );
  });

  it('puts identifier-like fields in the Identifiers preset', () => {
    const { presets } = computeProjectionFieldProfiles(objects);
    // `id` and `login` are identifier-leaf names.
    expect(presets.identifiers).toEqual(
      expect.arrayContaining(['id', 'login']),
    );
    expect(presets.identifiers).not.toContain('bio');
  });

  it('includes names and enum/status fields in Essentials', () => {
    const { presets } = computeProjectionFieldProfiles(objects);
    expect(presets.essentials).toEqual(
      expect.arrayContaining(['name', 'status']),
    );
  });

  it('returns empty presets for no objects', () => {
    const { fields, presets } = computeProjectionFieldProfiles([]);
    expect(fields).toEqual([]);
    expect(presets.identifiers).toEqual([]);
    expect(presets.essentials).toEqual([]);
  });
});
