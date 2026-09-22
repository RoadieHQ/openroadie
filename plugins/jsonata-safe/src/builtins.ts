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

export const JSONATA_SAFE_BUILTINS = [
  'string',
  'length',
  'substring',
  'substringBefore',
  'substringAfter',
  'uppercase',
  'lowercase',
  'trim',
  'pad',
  'contains',
  'split',
  'join',
  'match',
  'replace',
  'base64encode',
  'base64decode',
  'encodeUrlComponent',
  'encodeUrl',
  'decodeUrlComponent',
  'decodeUrl',
  'number',
  'abs',
  'floor',
  'ceil',
  'round',
  'power',
  'sqrt',
  'random',
  'formatNumber',
  'formatBase',
  'formatInteger',
  'parseInteger',
  'sum',
  'max',
  'min',
  'average',
  'boolean',
  'not',
  'exists',
  'count',
  'append',
  'sort',
  'reverse',
  'shuffle',
  'distinct',
  'zip',
  'keys',
  'values',
  'spread',
  'merge',
  'each',
  'error',
  'assert',
  'type',
  'lookup',
  'map',
  'filter',
  'single',
  'reduce',
  'sift',
  'now',
  'millis',
  'fromMillis',
  'toMillis',
  'parseYaml',
] as const;
