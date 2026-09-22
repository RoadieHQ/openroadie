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

import type { JsonValue } from '@roadiehq/types';

export interface PagedItem {
  object: JsonValue;
  orderKey: readonly number[];
}

export type PagedItems = readonly PagedItem[];

export interface InputStream {
  edgeId: string;
  sourceNodeId: string;
  pages: AsyncIterable<PagedItems>;
}

export interface NodeIO {
  inputs: ReadonlyMap<string, readonly InputStream[]>;
  emit(items: PagedItems): Promise<void>;
}

export const DEFAULT_HANDLE = 'default';
