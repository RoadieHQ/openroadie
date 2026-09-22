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

/**
 * Tags and filters a template is allowed to use. Anything a LiquidJS release
 * ships that is not listed here is stripped from the engine registry, so new
 * upstream features fail closed rather than becoming silently available.
 *
 * Excluded on purpose: `include` / `render` / `layout` (filesystem access),
 * `increment` / `decrement` (cross-render counters), `tablerow` and the
 * HTML-oriented filters (`newline_to_br`, `strip_html`, `escape`,
 * `escape_once`, `url_encode`, `url_decode`) — templates here produce
 * markdown/JSON context documents for agents, not HTML.
 */
export const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  '#',
  'assign',
  'break',
  'capture',
  'case',
  'comment',
  'continue',
  'cycle',
  'echo',
  'for',
  'if',
  'liquid',
  'raw',
  'unless',
]);

export const ALLOWED_FILTERS: ReadonlySet<string> = new Set([
  'abs',
  'append',
  'at_least',
  'at_most',
  'capitalize',
  'ceil',
  'compact',
  'concat',
  'date',
  'default',
  'divided_by',
  'downcase',
  'find',
  'find_exp',
  'first',
  'floor',
  'group_by',
  'group_by_exp',
  'has',
  'has_exp',
  'join',
  'json',
  'last',
  'lstrip',
  'map',
  'minus',
  'modulo',
  'plus',
  'prepend',
  'reject',
  'reject_exp',
  'remove',
  'remove_first',
  'remove_last',
  'replace',
  'replace_first',
  'replace_last',
  'reverse',
  'round',
  'rstrip',
  'size',
  'slice',
  'sort',
  'sort_natural',
  'split',
  'strip',
  'strip_newlines',
  'sum',
  'times',
  'truncate',
  'truncatewords',
  'uniq',
  'upcase',
  'where',
  'where_exp',
]);
