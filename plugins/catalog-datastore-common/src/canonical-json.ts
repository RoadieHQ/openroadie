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

import type { JsonValue } from '@roadiehq/types';

export function canonicalJsonStringify(value: JsonValue): string {
  return serialize(value);
}

function serialize(value: JsonValue): string {
  if (value === null) {
    return 'null';
  }

  const type = typeof value;

  if (type === 'number') {
    return JSON.stringify(value);
  }

  if (type === 'boolean' || type === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => serialize(item)).join(',')}]`;
  }

  const obj = value as { [key: string]: JsonValue };
  const keys = Object.keys(obj)
    .filter(key => obj[`${key}`] !== undefined)
    .sort();
  const parts = keys.map(
    key => `${JSON.stringify(key)}:${serialize(obj[`${key}`])}`,
  );
  return `{${parts.join(',')}}`;
}
