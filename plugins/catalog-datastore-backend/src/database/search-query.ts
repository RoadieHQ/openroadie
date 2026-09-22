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

/**
 * The shared text-search grammar over the `search_text` trigram column.
 * Extracted from ObjectDao so every surface that matches "object text contains
 * the query" (object search, context-group member search) agrees on the
 * semantics.
 */

export interface ParsedSearch {
  /** Substrings that must all appear somewhere in the object's text. */
  include: string[];
  /** Substrings that must NOT appear. */
  exclude: string[];
}

/**
 * Parse a user query into the substrings that should/shouldn't appear in the
 * object's text. Supports:
 *
 * - bare tokens (`john doe`) → AND of `%john%` and `%doe%`.
 * - quoted phrases (`"quick brown"`) → single literal `%quick brown%` pattern.
 * - leading `-` for negation (`service -staging`, `-"in progress"`).
 *
 * Substring matching happens against `search_text` (the generated text column
 * backed by a GIN trigram index), so all of these are indexed lookups.
 *
 * Returns `null` when there's nothing to match (e.g. whitespace only).
 */
export function parseSearchQuery(q: string): ParsedSearch | null {
  const include: string[] = [];
  const exclude: string[] = [];

  // Pull out quoted (optionally negated) phrases first.
  const quotedPhrase = /(-)?"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = quotedPhrase.exec(q)) !== null) {
    const text = match[2].trim();
    if (!text) continue;
    if (match[1]) exclude.push(text);
    else include.push(text);
  }

  // Then split the remainder on whitespace and classify each bare token.
  const remainder = q.replace(quotedPhrase, ' ');
  for (const rawToken of remainder.split(/\s+/)) {
    const token = rawToken.trim();
    if (!token) continue;
    if (token.startsWith('-') && token.length > 1) {
      exclude.push(token.slice(1));
    } else {
      include.push(token);
    }
  }

  if (include.length === 0 && exclude.length === 0) {
    return null;
  }
  return { include, exclude };
}

/** Escape ILIKE wildcards so user input is matched literally. */
export function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
