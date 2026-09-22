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
import { buildFieldProfiles } from '../schemas/field-profiling';

/** A single field offered to the projection picker, with the deterministic
 *  signals that drive presets. */
export interface ProjectionFieldInfo {
  path: string;
  valueType: string;
  container: string;
  isIdentifierLike: boolean;
  looksEnumLike: boolean;
  rowCoverage: number;
  cardinalityRatio: number;
}

/** Deterministic starting selections, as lists of field paths. `full` is
 *  implicit (no projection), so it isn't returned. */
export interface ProjectionPresets {
  identifiers: string[];
  essentials: string[];
}

export interface DatasourceFieldProfiles {
  datasourceId: string;
  fields: ProjectionFieldInfo[];
  presets: ProjectionPresets;
}

// Only offer fields the projection engine (dot-path `getNestedValue`) can
// resolve: plain identifier-segment dot-paths. Array/quoted/bracketed paths from
// the profiler are excluded for now.
const CLEAN_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
const NAME_LEAF =
  /^(name|title|label|displayname|display_name|summary|full_name|fullname)$/i;
const ID_LEAF =
  /^(id|key|slug|uuid|number|login|email|handle|ref|url|html_url)$/i;
const STATUS_LEAF =
  /^(status|state|type|kind|severity|priority|phase|level|visibility|category)$/i;

const ESSENTIALS_CAP = 15;

function leafSegment(path: string): string {
  const parts = path.split('.');
  return parts[parts.length - 1];
}

function depth(path: string): number {
  return path.split('.').length;
}

/**
 * Turn sampled datasource objects into the field list + deterministic presets
 * that seed the projection picker. Reuses the relationship-suggestion field
 * profiling, so the identifier/enum/coverage signals are single-sourced.
 */
export function computeProjectionFieldProfiles(objects: unknown[]): {
  fields: ProjectionFieldInfo[];
  presets: ProjectionPresets;
} {
  const { profilesByField } = buildFieldProfiles(objects);

  const fields: ProjectionFieldInfo[] = Object.values(profilesByField)
    // The profiler emits JSONata-style paths rooted at `$`; strip it so the
    // path is the plain dot-path the projection engine resolves.
    .map(profile => ({
      profile,
      path: profile.field.replace(/^\$\./, ''),
    }))
    .filter(({ path }) => Boolean(path) && CLEAN_PATH.test(path))
    .map(({ profile, path }) => ({
      path,
      valueType: profile.dominantValueType,
      container: profile.valueContainer,
      isIdentifierLike: profile.isIdentifierLike,
      looksEnumLike: profile.looksEnumLike,
      rowCoverage: profile.rowCoverage,
      cardinalityRatio: profile.cardinalityRatio,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const identifiers = fields.filter(
    field => field.isIdentifierLike || ID_LEAF.test(leafSegment(field.path)),
  );

  const essentials = new Set<string>(identifiers.map(field => field.path));
  for (const field of fields) {
    const leaf = leafSegment(field.path);
    const isNameLike = NAME_LEAF.test(leaf);
    const isStatusLike = field.looksEnumLike || STATUS_LEAF.test(leaf);
    const shallowScalar =
      field.container === 'scalar' &&
      depth(field.path) <= 2 &&
      field.rowCoverage >= 0.5;
    const noisy =
      field.rowCoverage < 0.3 ||
      depth(field.path) > 2 ||
      field.container === 'array';
    if (!noisy && (isNameLike || isStatusLike || shallowScalar)) {
      essentials.add(field.path);
    }
  }

  return {
    fields,
    presets: {
      identifiers: identifiers.map(field => field.path),
      essentials: fields
        .filter(field => essentials.has(field.path))
        .map(field => field.path)
        .slice(0, ESSENTIALS_CAP),
    },
  };
}
