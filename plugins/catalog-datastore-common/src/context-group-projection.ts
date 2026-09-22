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
import { getNestedValue } from './filter-utils';

/**
 * A single entry in an include-mode projection. Maps a dot-notation source path
 * in the object JSON to a labeled key in the bundle output. E.g. `metadata.role`
 * -> `role`.
 */
export interface FieldMapping {
  /** Dot-notation path into the object JSON (e.g. `metadata.role`). */
  source: string;
  /** The key this value is emitted under in the projected bundle output. */
  label: string;
}

/**
 * A titled piece of free-text instruction attached to a context group rule or to
 * a datasource within a rule. Tells the AI agent how to interpret or use the
 * data. Static — may reference projected field names conceptually but is not
 * interpolated per item.
 */
export interface Annotation {
  title: string;
  text: string;
}

/** Emit only the listed fields, each optionally relabeled. */
export interface IncludeProjection {
  mode: 'include';
  fields: FieldMapping[];
}

/** Emit the whole object minus the listed dot-paths, keeping original keys. */
export interface ExcludeProjection {
  mode: 'exclude';
  paths: string[];
}

export type Projection = IncludeProjection | ExcludeProjection;

/**
 * The persisted projection shape, tolerant of the legacy ADR-0001 form where a
 * projection was a bare `FieldMapping[]` (read as include mode).
 */
export type ProjectionValue = Projection | FieldMapping[];

function isProjectionEmpty(projection?: ProjectionValue): boolean {
  if (!projection) return true;
  if (Array.isArray(projection)) return projection.length === 0;
  if (projection.mode === 'include') return projection.fields.length === 0;
  return projection.paths.length === 0;
}

function excludePaths(object: unknown, paths: string[]): unknown {
  if (object === null || typeof object !== 'object') {
    return object;
  }
  // Objects in the datastore are JSON, so a JSON round-trip is a safe deep clone
  // that avoids mutating the caller's object.
  const clone = JSON.parse(JSON.stringify(object)) as Record<string, unknown>;
  for (const path of paths) {
    if (!path) continue;
    const segments = path.split('.');
    let cursor: unknown = clone;
    for (let i = 0; i < segments.length - 1; i++) {
      if (cursor === null || typeof cursor !== 'object') {
        cursor = null;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[`${segments[`${i}`]}`];
    }
    const last = segments[segments.length - 1];
    if (cursor !== null && typeof cursor === 'object') {
      delete (cursor as Record<string, unknown>)[`${last}`];
    }
  }
  return clone;
}

/**
 * Apply a read-time projection to a single object. Include mode emits only the
 * mapped fields (dot-path source -> label); exclude mode returns the object with
 * the listed paths removed. An empty or absent projection returns the object
 * unchanged, which keeps bundles backwards compatible with rules that define no
 * projection. A bare `FieldMapping[]` is treated as include mode.
 */
export function applyProjection(
  object: unknown,
  projection?: ProjectionValue,
): unknown {
  if (isProjectionEmpty(projection)) {
    return object;
  }

  if (!Array.isArray(projection) && projection!.mode === 'exclude') {
    return excludePaths(object, projection!.paths);
  }

  const fields = Array.isArray(projection)
    ? projection
    : (projection as IncludeProjection).fields;
  const result: Record<string, unknown> = {};
  for (const mapping of fields) {
    if (!mapping.source || !mapping.label) continue;
    result[`${mapping.label}`] = getNestedValue(object, mapping.source);
  }
  return result;
}
