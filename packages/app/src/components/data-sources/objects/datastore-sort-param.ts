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

import type { SortingState } from '@tanstack/react-table';

/**
 * The datastore table's sort, carried in `?sort=`, with a leading `-` for
 * descending (`?sort=title`, `?sort=-relationshipCount`).
 *
 * Single-column only, matching the table: the backend takes one `orderBy`, and
 * `useDataSourceObjects` only ever sends `sorting[0]`. Extra values are dropped
 * rather than silently half-applied.
 */
export function readDatastoreSortFromParams(
  params: URLSearchParams,
): SortingState {
  const raw = params.get('sort')?.trim();
  if (!raw) {
    return [];
  }
  const desc = raw.startsWith('-');
  const id = desc ? raw.slice(1) : raw;
  return id ? [{ id, desc }] : [];
}

/** Serialize a sort for the URL; `null` means the param should be removed. */
export function datastoreSortParam(sorting: SortingState): string | null {
  const sort = sorting[0];
  if (!sort?.id) {
    return null;
  }
  return sort.desc ? `-${sort.id}` : sort.id;
}
