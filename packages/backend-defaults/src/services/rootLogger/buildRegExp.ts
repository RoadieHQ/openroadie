/*
 * Copyright 2024 Larder Software Ltd.
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
 * Upper bound on the length of an admin-supplied logger override pattern.
 * Bounds the worst-case ReDoS exposure of any regex built from a free-form
 * pattern string supplied via `backend.logger.overrides`. Sized generously
 * above any realistic operator-authored pattern.
 */
const MAX_OVERRIDE_PATTERN_LENGTH = 4096;

/**
 * Constructs a RegExp from an admin-supplied logger override pattern (e.g.
 * entries under `backend.logger.overrides`). Treated as trusted-but-validated:
 *  - length is capped to bound ReDoS exposure on free-form input
 *  - construction failures are surfaced as a configuration error rather than
 *    crashing somewhere downstream at first match attempt
 *
 * Callers that need to build a pattern from arbitrary literal alternatives
 * (e.g. a redaction list) should use {@link buildRedactionRegExp} instead;
 * that function escapes its inputs and is structurally ReDoS-safe regardless
 * of length.
 */
export function buildOverrideRegExp(pattern: string, flags?: string): RegExp {
  if (pattern.length > MAX_OVERRIDE_PATTERN_LENGTH) {
    throw new Error(
      `logger override pattern exceeds ${MAX_OVERRIDE_PATTERN_LENGTH} chars (got ${pattern.length})`,
    );
  }
  try {
    // eslint-disable-next-line security/detect-non-literal-regexp -- admin-supplied logger override pattern; trusted config source, length-capped above to bound ReDoS risk
    return new RegExp(pattern, flags);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`invalid logger override pattern "${pattern}": ${msg}`);
  }
}

/**
 * Builds a redaction RegExp from a list of literal secret values. Each value
 * is regex-escaped before being joined with `|` inside a capture group, so
 * the resulting pattern contains only literal characters plus the alternation
 * operator — no quantifiers, no nested groups, no backreferences, no ReDoS
 * surface. Pattern length is therefore unbounded by design: callers that
 * register many secrets (API keys, tokens, passwords) will produce a long
 * but structurally safe pattern.
 */
export function buildRedactionRegExp(
  secrets: readonly string[],
  flags?: string,
): RegExp {
  const escaped = secrets.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = `(${escaped.join('|')})`;
  // eslint-disable-next-line security/detect-non-literal-regexp -- redaction pattern composed only from regex-escaped literal secrets joined by alternation; structurally ReDoS-safe regardless of length
  return new RegExp(pattern, flags);
}
