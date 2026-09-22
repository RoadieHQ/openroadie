import {
  compileViewTemplateWithMarker,
  LEGACY_MARKER_PREFIX,
  MARKER_PREFIX,
} from './compile-template';
import { viewSpecSchema, type ViewSpec } from './types';

/**
 * Recover the builder spec from a stored template, or `null` when the template
 * isn't builder-owned.
 *
 * Accepts both the current `roadie:view:v1` marker and the legacy
 * `roadie:projection:v1` marker so existing saved templates still open in the
 * builder. Round-trip comparison uses the same marker prefix found in the
 * template; newly compiled templates always emit the current marker.
 *
 * The marker alone isn't trusted: a template can be edited by hand, through the
 * API, or by an agent, leaving a marker that no longer describes the body. So
 * the recovered spec is recompiled and compared byte-for-byte with the input —
 * any drift means the body is the user's, not the builder's, and the caller
 * falls back to advanced mode instead of silently overwriting their edits.
 */
export function parseViewTemplate(template: string): ViewSpec | null {
  for (const prefix of [MARKER_PREFIX, LEGACY_MARKER_PREFIX]) {
    const markerOpen = `{% comment %}${prefix}`;
    const markerClose = '{% endcomment %}';
    if (!template?.startsWith(markerOpen)) {
      continue;
    }
    const close = template.indexOf(markerClose, markerOpen.length);
    if (close === -1) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(template.slice(markerOpen.length, close));
    } catch {
      return null;
    }

    const result = viewSpecSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }

    const spec = result.data as ViewSpec;
    return compileViewTemplateWithMarker(spec, prefix) === template
      ? spec
      : null;
  }
  return null;
}
