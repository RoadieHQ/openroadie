import { autoLabel } from '../projection-utils';
import {
  VIEW_SPEC_VERSION,
  type ViewField,
  type ViewRelated,
  type ViewSource,
  type ViewSpec,
} from './types';

export const MARKER_PREFIX = `roadie:view:v${VIEW_SPEC_VERSION} `;
export const LEGACY_MARKER_PREFIX = `roadie:projection:v${VIEW_SPEC_VERSION} `;

/**
 * Serialize the spec for the marker comment. Structural JSON never produces
 * `{{` or `{%` (a brace is always followed by `"` or `[`), so only a user-typed
 * label can open a Liquid token inside the comment — escape the opening brace
 * of any such pair to `{`, which JSON.parse turns back into `{`.
 */
function encodeSpec(spec: ViewSpec): string {
  return JSON.stringify(spec).replace(/\{(?=[{%])/g, '\\u007b');
}

/**
 * Neutralize literal text the template emits. Labels are user-typed, so a
 * stray `{{` or `{%` would turn an output key into a broken tag — drop the
 * brace that opens the sequence and the rest is inert text. Deterministic, so
 * the parser's recompile check still holds for a spec carrying such a label.
 */
function literal(text: string): string {
  return text.replace(/\{(?=[{%])/g, '');
}

/** A single-quoted Liquid string argument. Characters that would end the tag
 *  or the string early are dropped rather than escaped — nothing that reaches
 *  here (a relationship type) legitimately contains them. */
function liquidStringArg(text: string): string {
  return `'${text.replace(/[{}%'\\]/g, '')}'`;
}

/** The output key for a field: its explicit label, else the path's leaf
 *  segment disambiguated against the other fields of the same block. */
export function outputKey(field: ViewField, siblings: ViewField[]): string {
  const label = field.label?.trim();
  if (label) return literal(label);
  return autoLabel(
    field.path,
    siblings.map(f => f.path),
  );
}

/** The Liquid accessor for a document key: dotted for identifier-safe keys
 *  (byte-identical to what older builder versions compiled, so their stored
 *  templates still round-trip), bracket access for slug keys with hyphens.
 *  Quotes/backslashes can't survive in a key — they'd break the bracket
 *  string — so they're dropped, mirroring liquidStringArg. */
export function memberAccess(key: string): string {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)
    ? `members.${key}`
    : `members['${key.replace(/['\\]/g, '')}']`;
}

/** `{% for x in y %}` with an optional `limit:`, which Liquid applies to the
 *  collection before iterating. */
function forTag(variable: string, collection: string, limit?: number): string {
  const limitClause = limit ? ` limit: ${limit}` : '';
  return `{% for ${variable} in ${collection}${limitClause} %}`;
}

function jsonFieldLines(
  fields: ViewField[],
  variable: string,
  indent: string,
): string[] {
  if (fields.length === 0) {
    return [`${indent}"data": {{ ${variable}.data | json: 2 }}`];
  }
  return fields.map(
    field =>
      `${indent}${JSON.stringify(outputKey(field, fields))}: {{ ${variable}.data.${field.path} | json }}`,
  );
}

function jsonRelatedBlock(
  related: ViewRelated,
  index: number,
  indent: string,
): string {
  const assignee = `related_${index}`;
  const innerIndent = `${indent}  `;
  const entries = [
    `${innerIndent}  "objectId": {{ rel.objectId | json }}`,
    ...jsonFieldLines(related.fields, 'rel', `${innerIndent}  `),
  ];
  return [
    `{% assign ${assignee} = member | related: ${liquidStringArg(related.type)} %}${indent}${JSON.stringify(literal(related.type))}: [`,
    `${forTag('rel', assignee, related.limit)}${innerIndent}{`,
    entries.join(',\n'),
    `${innerIndent}}{% unless forloop.last %},{% endunless %}`,
    `{% endfor %}${indent}]`,
  ].join('\n');
}

function compileJson(spec: ViewSpec): string {
  if (spec.sources.length === 0) {
    return '{}';
  }
  const blocks = spec.sources.map((source, sourceIndex) => {
    const entries = [
      '      "objectId": {{ member.objectId | json }}',
      ...jsonFieldLines(source.fields, 'member', '      '),
      ...source.related.map((related, index) =>
        jsonRelatedBlock(related, index, '      '),
      ),
    ];
    const trailingComma = sourceIndex === spec.sources.length - 1 ? '' : ',';
    return [
      `  ${JSON.stringify(source.key)}: [`,
      `${forTag('member', memberAccess(source.key), source.limit)}    {`,
      entries.join(',\n'),
      '    }{% unless forloop.last %},{% endunless %}',
      `{% endfor %}  ]${trailingComma}`,
    ].join('\n');
  });
  return ['{', ...blocks, '}'].join('\n');
}

/** The bullet's headline: the first selected field, falling back to the object
 *  id so a member never renders as an empty bullet. */
function headline(fields: ViewField[], variable: string): string {
  if (fields.length === 0) {
    return `{{ ${variable}.objectId }}`;
  }
  return `{{ ${variable}.data.${fields[0].path} | default: ${variable}.objectId }}`;
}

function markdownRelatedBlock(related: ViewRelated, index: number): string {
  const assignee = `related_${index}`;
  const trailing = related.fields
    .slice(1)
    .map(
      field =>
        `${outputKey(field, related.fields)}: {{ rel.data.${field.path} }}`,
    );
  const suffix = trailing.length > 0 ? ` — ${trailing.join(', ')}` : '';
  return [
    `  - ${literal(related.type)}:`,
    `{% assign ${assignee} = member | related: ${liquidStringArg(related.type)} %}${forTag('rel', assignee, related.limit)}    - ${headline(related.fields, 'rel')}${suffix}`,
    '{% endfor %}',
  ].join('\n');
}

function compileMarkdown(spec: ViewSpec): string {
  if (spec.sources.length === 0) {
    return '';
  }
  return spec.sources
    .map(source => {
      const detail =
        source.fields.length === 0
          ? ['  ```json', '  {{ member.data | json: 2 }}', '  ```']
          : source.fields
              .slice(1)
              .map(
                field =>
                  `  - ${outputKey(field, source.fields)}: {{ member.data.${field.path} }}`,
              );
      return [
        `## ${literal(source.label)}`,
        `${forTag('member', memberAccess(source.key), source.limit)}- **${headline(source.fields, 'member')}**`,
        ...detail,
        ...source.related.map(markdownRelatedBlock),
        '{% endfor %}',
      ].join('\n');
    })
    .join('\n');
}

function textRelatedBlock(related: ViewRelated, index: number): string {
  const assignee = `related_${index}`;
  const trailing = related.fields
    .slice(1)
    .map(
      field =>
        `${outputKey(field, related.fields)}: {{ rel.data.${field.path} }}`,
    );
  const suffix = trailing.length > 0 ? ` (${trailing.join(', ')})` : '';
  return [
    `{% assign ${assignee} = member | related: ${liquidStringArg(related.type)} %}${forTag('rel', assignee, related.limit)}    ${literal(related.type)}: ${headline(related.fields, 'rel')}${suffix}`,
    '{% endfor %}',
  ].join('\n');
}

function compileText(spec: ViewSpec): string {
  if (spec.sources.length === 0) {
    return '';
  }
  return spec.sources
    .map(source => {
      const detail =
        source.fields.length === 0
          ? ['  {{ member.data | json }}']
          : source.fields
              .slice(1)
              .map(
                field =>
                  `  ${outputKey(field, source.fields)}: {{ member.data.${field.path} }}`,
              );
      return [
        `== ${literal(source.label)} ==`,
        `${forTag('member', memberAccess(source.key), source.limit)}${headline(source.fields, 'member')}`,
        ...detail,
        ...source.related.map(textRelatedBlock),
        '{% endfor %}',
      ].join('\n');
    })
    .join('\n');
}

/**
 * Compile a builder spec to the Liquid template that is actually stored and
 * rendered. The spec rides along in a leading `{% comment %}` marker so
 * `parseViewTemplate` can round-trip it; the comment renders to nothing,
 * so an agent never sees it.
 *
 * The output is a pure, deterministic function of the spec — the parser relies
 * on recompiling and comparing byte-for-byte to detect hand edits.
 */
export function compileViewTemplateWithMarker(
  spec: ViewSpec,
  markerPrefix: string,
): string {
  const body =
    spec.format === 'json'
      ? compileJson(spec)
      : spec.format === 'markdown'
        ? compileMarkdown(spec)
        : compileText(spec);
  return `{% comment %}${markerPrefix}${encodeSpec(spec)}{% endcomment %}\n${body}`;
}

export function compileViewTemplate(spec: ViewSpec): string {
  return compileViewTemplateWithMarker(spec, MARKER_PREFIX);
}

/** A source with every field of the object, for the "everything" starter. */
export function fullSource(key: string, label: string): ViewSource {
  return { key, label, fields: [], related: [] };
}
