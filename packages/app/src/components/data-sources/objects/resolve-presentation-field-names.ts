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

/**
 * Naming the datastore table's Title / Secondary columns after the object field
 * they actually came from ("Email", "Full name") rather than the generic role.
 *
 * The field name is knowable three ways, in descending confidence: the index
 * configuration's value expression (an operator wrote it), the shared
 * presentation resolver matching a rendered value back to its source key, or —
 * for sources with no configured presentation at all — a guess from a candidate
 * list of conventional field names. Siblings of {@link resolveObjectDisplayName},
 * which picks the *value* these functions label.
 */

import { resolvePresentationFieldName } from '@roadiehq/catalog-datastore-common';
import type { IndexConfiguration } from '../../../api/datastore/datastore-client';
import type { DataSourceObjectRow } from './use-data-source-objects';

/** Index keys that identify the record rather than describe it. */
const BUILT_IN_COLUMN_IDS = new Set(['id', 'objectId']);
/** Index purposes already rendered by a dedicated column. */
const PRESENTATION_PURPOSES = new Set(['title', 'subtitle', 'image']);

/** True for indexes that earn their own value column in the table. */
export function isIndexTableColumn(index: IndexConfiguration): boolean {
  return (
    !BUILT_IN_COLUMN_IDS.has(index.key) &&
    !PRESENTATION_PURPOSES.has(index.purpose ?? 'column')
  );
}

export function humanizeIndexKey(key: string): string {
  return key
    .replace(/^presentation\./, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.]/g, ' ')
    .trim();
}

export function capitalizeFieldLabel(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function columnHeaderLabelFromKey(key: string): string {
  return capitalizeFieldLabel(humanizeIndexKey(key));
}

function isValidPathSegment(segment: string): boolean {
  if (!segment) {
    return false;
  }
  for (const char of segment) {
    const code = char.charCodeAt(0);
    const isAlpha = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const isDigit = code >= 48 && code <= 57;
    if (!isAlpha && !isDigit && char !== '_' && char !== '$') {
      return false;
    }
  }
  return true;
}

function fieldLabelFromPathExpression(expression: string): string | undefined {
  const normalized = expression.trim();
  const withoutPrefix = normalized.startsWith('$.')
    ? normalized.slice(2)
    : normalized;
  if (!withoutPrefix) {
    return undefined;
  }
  const segments = withoutPrefix.split('.');
  if (!segments.every(isValidPathSegment)) {
    return undefined;
  }
  const segment = segments.at(-1);
  return segment ? humanizeIndexKey(segment) : undefined;
}

/**
 * Label a value expression by its leaf field. Handles the conditional form
 * (`a ? b : c`) by labelling every branch — `name / login` — so a column whose
 * value comes from one of several fields says so.
 */
export function fieldLabelFromExpression(
  expression: string,
): string | undefined {
  const pathLabel = fieldLabelFromPathExpression(expression);
  if (pathLabel) {
    return pathLabel;
  }

  if (!expression.includes('?') || !expression.includes(':')) {
    return undefined;
  }

  const labels = expression
    .split(/[?:]/)
    .map(part => fieldLabelFromPathExpression(part))
    .filter((label): label is string => Boolean(label));
  const uniqueLabels = labels.filter(
    (label, index) => labels.indexOf(label) === index,
  );

  return uniqueLabels.length > 0 ? uniqueLabels.join(' / ') : undefined;
}

export function presentationIndex(
  indexes: IndexConfiguration[],
  purpose: 'title' | 'subtitle',
): IndexConfiguration | undefined {
  return indexes.find(index => index.purpose === purpose);
}

const titleFieldCandidates: Array<{
  label: string;
  path: readonly string[];
}> = [
  { label: 'name', path: ['name'] },
  { label: 'display name', path: ['display_name'] },
  { label: 'display name', path: ['displayName'] },
  { label: 'title', path: ['title'] },
  { label: 'full name', path: ['full_name'] },
  { label: 'login', path: ['login'] },
  { label: 'username', path: ['username'] },
  { label: 'email', path: ['email'] },
  { label: 'slug', path: ['slug'] },
  { label: 'name', path: ['profile', 'name'] },
  { label: 'display name', path: ['profile', 'display_name'] },
  { label: 'display name', path: ['profile', 'displayName'] },
  { label: 'title', path: ['fields', 'title'] },
  { label: 'name', path: ['fields', 'name'] },
];

const subtitleFieldCandidates: Array<{
  label: string;
  path: readonly string[];
}> = [
  { label: 'email', path: ['email'] },
  { label: 'email', path: ['mail'] },
  { label: 'email', path: ['emailAddress'] },
  { label: 'email', path: ['primaryEmail'] },
  { label: 'user principal name', path: ['userPrincipalName'] },
  { label: 'email', path: ['profile', 'email'] },
  { label: 'email', path: ['profile', 'email_address'] },
  { label: 'type', path: ['type'] },
  { label: 'kind', path: ['kind'] },
  { label: 'entity type', path: ['entityType'] },
  { label: 'entity type', path: ['entity_type'] },
  { label: 'resource type', path: ['resourceType'] },
  { label: 'resource type', path: ['resource_type'] },
  { label: 'account type', path: ['accountType'] },
  { label: 'status', path: ['status'] },
  { label: 'state', path: ['state'] },
  { label: 'state', path: ['state', 'name'] },
  { label: 'severity', path: ['severity'] },
  { label: 'role', path: ['role'] },
  { label: 'key', path: ['key'] },
  { label: 'identifier', path: ['identifier'] },
  { label: 'slug', path: ['slug'] },
  { label: 'path with namespace', path: ['path_with_namespace'] },
  { label: 'namespace', path: ['metadata', 'namespace'] },
  { label: 'namespace', path: ['namespace'] },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Look up one path segment, preferring an exact key and falling back to a
 * case-insensitive match — data sources disagree on casing for the same field.
 */
function valueForSegment(
  record: Record<string, unknown>,
  segment: string,
): unknown {
  if (Object.hasOwn(record, segment)) {
    return record[`${segment}`];
  }
  const lowercaseSegment = segment.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === lowercaseSegment) {
      return record[`${key}`];
    }
  }
  return undefined;
}

function valueAtPath(
  objectJson: unknown,
  path: readonly string[],
): string | undefined {
  let current = objectJson;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = valueForSegment(current, segment);
  }
  return typeof current === 'string' && current.trim().length > 0
    ? current.trim()
    : undefined;
}

export function resolveSubtitleFieldName(
  row: DataSourceObjectRow,
  indexes: IndexConfiguration[],
): string | undefined {
  const subtitle = row.presentation?.subtitle;
  if (!subtitle) {
    // No configured/derived subtitle: infer from the first secondary field
    // present on the object, skipping whichever field supplies the title so the
    // two columns don't collapse onto the same field.
    const titlePath = titleFieldCandidates.find(
      candidate => valueAtPath(row.object, candidate.path) !== undefined,
    )?.path;
    const titleKey = titlePath?.join('.');
    return subtitleFieldCandidates.find(
      candidate =>
        valueAtPath(row.object, candidate.path) !== undefined &&
        candidate.path.join('.') !== titleKey,
    )?.label;
  }
  const configured = presentationIndex(indexes, 'subtitle');
  if (configured && row.indexValues.get(configured.key) === subtitle) {
    return (
      fieldLabelFromExpression(configured.valueExpression) ??
      resolvePresentationFieldName(row.object, subtitle, 'subtitle') ??
      humanizeIndexKey(configured.key)
    );
  }
  return (
    resolvePresentationFieldName(row.object, subtitle, 'subtitle') ??
    subtitleFieldCandidates.find(
      candidate => valueAtPath(row.object, candidate.path) === subtitle,
    )?.label
  );
}

export function resolveTitleFieldName(
  row: DataSourceObjectRow,
  indexes: IndexConfiguration[],
): string | undefined {
  const title = row.presentation?.title;
  if (!title) {
    // No configured/derived title: infer the label from whichever object field
    // supplies the display name (mirrors resolveObjectDisplayName), so the title
    // column is labelled by its source field (e.g. `email` -> "Email").
    return titleFieldCandidates.find(
      candidate => valueAtPath(row.object, candidate.path) !== undefined,
    )?.label;
  }
  const configured = presentationIndex(indexes, 'title');
  if (configured && row.indexValues.get(configured.key) === title) {
    return (
      fieldLabelFromExpression(configured.valueExpression) ??
      resolvePresentationFieldName(row.object, title, 'title') ??
      humanizeIndexKey(configured.key)
    );
  }
  return (
    resolvePresentationFieldName(row.object, title, 'title') ??
    titleFieldCandidates.find(
      candidate => valueAtPath(row.object, candidate.path) === title,
    )?.label
  );
}

/**
 * First field name any row on the page can supply for the purpose. Rows in one
 * data source are heterogeneous, so an early row missing the field shouldn't
 * leave the column unlabelled.
 */
export function firstPresentationFieldName(
  rows: DataSourceObjectRow[],
  indexes: IndexConfiguration[],
  purpose: 'title' | 'subtitle',
): string | undefined {
  for (const row of rows) {
    const fieldName =
      purpose === 'title'
        ? resolveTitleFieldName(row, indexes)
        : resolveSubtitleFieldName(row, indexes);
    if (fieldName) {
      return fieldName;
    }
  }
  return undefined;
}

export function configuredPresentationFieldName(
  index: IndexConfiguration | undefined,
  rows: DataSourceObjectRow[],
  indexes: IndexConfiguration[],
  purpose: 'title' | 'subtitle',
): string | undefined {
  if (!index) {
    return undefined;
  }

  const expressionLabel = fieldLabelFromExpression(index.valueExpression);
  // A synthetic key (`presentation.title` -> "title") names the role, not the
  // field, so fall through to the rows for something more specific.
  if (expressionLabel && expressionLabel !== purpose) {
    return expressionLabel;
  }

  return (
    firstPresentationFieldName(rows, indexes, purpose) ??
    humanizeIndexKey(index.key)
  );
}

export interface PresentationColumnLabels {
  titleLabel: string;
  subtitleLabel: string;
}

/**
 * Header labels for the Title / Secondary columns.
 *
 * The single entry point for the table: scanning rows against the candidate
 * lists is the expensive part of this module, so callers should compute this
 * once per (rows, indexes) rather than per render. Cross-source mode spans
 * sources with no shared schema, so it keeps the generic role names and skips
 * the scan altogether.
 */
export function resolvePresentationColumnLabels(
  rows: DataSourceObjectRow[],
  indexes: IndexConfiguration[],
  allMode: boolean,
): PresentationColumnLabels {
  if (allMode) {
    return { titleLabel: 'Title', subtitleLabel: 'Secondary' };
  }

  const label = (purpose: 'title' | 'subtitle', fallback: string) => {
    const configured = presentationIndex(indexes, purpose);
    const fieldName =
      configuredPresentationFieldName(configured, rows, indexes, purpose) ??
      firstPresentationFieldName(rows, indexes, purpose);
    return capitalizeFieldLabel(fieldName ?? fallback);
  };

  return {
    titleLabel: label('title', 'Title'),
    subtitleLabel: label('subtitle', 'Secondary'),
  };
}

/**
 * Per-row subtitle field names, keyed by row id, for the cell tooltip and the
 * cross-source pill. Only rows that actually render a subtitle are resolved —
 * matching the cell — because a row without one takes the expensive guess path.
 */
export function resolveSubtitleFieldNamesByRow(
  rows: DataSourceObjectRow[],
  indexes: IndexConfiguration[],
): Map<string, string | undefined> {
  const names = new Map<string, string | undefined>();
  for (const row of rows) {
    names.set(
      row.id,
      row.presentation?.subtitle
        ? resolveSubtitleFieldName(row, indexes)
        : undefined,
    );
  }
  return names;
}
