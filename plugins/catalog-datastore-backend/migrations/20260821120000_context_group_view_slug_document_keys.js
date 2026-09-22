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
 * Rewrite stored view templates from the old underscored document keys
 * (`members.github_members`) to the real datasource slugs
 * (`members['github-members']`) that `getRuleDocumentKeys` now emits.
 *
 * The rewrite is textual because the slugs live in the workflow plugin's
 * database, which this plugin's migrations cannot reach. It is still exact
 * for every slug-derived key: the old key was the slug with each run of
 * non-alphanumerics collapsed to `_`, and the slug grammar
 * (`^[a-z0-9]+(-[a-z0-9]+)*$`) contains no underscores and no separator
 * runs, so `_` → `-` recovers the slug byte-for-byte. Keys derived from the
 * old fallback labels (display/seed name when slug resolution failed) are
 * not reliably invertible — but those keys were unstable and already render
 * empty under the new scheme, and the labels were slugified from the same
 * names as the slugs, so the hyphenated guess is the best available.
 *
 * Builder-owned templates carry a `{% comment %}roadie:view:v1 {…}` marker
 * whose spec must recompile byte-for-byte to the body, or the builder drops
 * the view to advanced mode. The rewrite therefore moves the marker's
 * `sources[].key` values and the JSON format's quoted section keys together
 * with the accessors, producing exactly what the builder's compiler emits
 * for hyphenated keys (bracket access `members['x-y']`, quoted key `"x-y"`).
 * Hand-edited templates get only their `members.…` accessors rewritten.
 */

const MARKER_PREFIXES = ['roadie:view:v1 ', 'roadie:projection:v1 '];
const MARKER_CLOSE = '{% endcomment %}';

// A slugifyDocumentKey output that actually contains an underscore — the only
// old-scheme keys the new slug-keyed scheme no longer produces.
const OLD_KEY = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;
const DOTTED_REF =
  /(?<![a-zA-Z0-9_.])members\.([a-z0-9]+(?:_[a-z0-9]+)+)(?![a-zA-Z0-9_])/g;
const BRACKET_REF =
  /(?<![a-zA-Z0-9_.])members\['([a-z0-9]+(?:_[a-z0-9]+)+)'\]/g;

function toSlug(key) {
  return key.replace(/_/g, '-');
}

function markerSourceKeys(template) {
  for (const prefix of MARKER_PREFIXES) {
    const open = `{% comment %}${prefix}`;
    if (!template.startsWith(open)) {
      continue;
    }
    const close = template.indexOf(MARKER_CLOSE, open.length);
    if (close === -1) {
      return [];
    }
    let spec;
    try {
      spec = JSON.parse(template.slice(open.length, close));
    } catch {
      return [];
    }
    const sources = Array.isArray(spec?.sources) ? spec.sources : [];
    return sources
      .map(source => source?.key)
      .filter(key => typeof key === 'string' && OLD_KEY.test(key));
  }
  return [];
}

function rewriteTemplate(template) {
  let result = template
    .replace(DOTTED_REF, (_, key) => `members['${toSlug(key)}']`)
    .replace(BRACKET_REF, (_, key) => `members['${toSlug(key)}']`);
  for (const key of markerSourceKeys(template)) {
    // The marker's `"key":"…"` and the JSON format's quoted section keys must
    // move with the accessors, or the builder's byte-for-byte recompile check
    // fails and the view falls back to advanced mode.
    result = result.split(`"${key}"`).join(`"${toSlug(key)}"`);
  }
  return result;
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const rows = await knex('context_group_view').select('id', 'template');
  for (const row of rows) {
    const template = rewriteTemplate(row.template);
    if (template !== row.template) {
      await knex('context_group_view')
        .where({ id: row.id })
        .update({ template });
    }
  }
};

// Fallback-label keys can't be reconstructed, and rewritten slug keys are
// indistinguishable from templates that were always slug-keyed — the rewrite
// is one-way on purpose. Schema is unchanged.
exports.down = async function down() {};
