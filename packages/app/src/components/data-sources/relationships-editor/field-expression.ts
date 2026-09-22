// Shared helpers for reasoning about the JSONata *accessor* expressions the
// relationship editor lets you author for a field / match — the Source and
// Target fields and the Lookup response match. These are the expressions the
// Field | Expression toggle switches between: a "plain" accessor path can be
// represented by (and picked from) the field picker; anything richer (a
// wildcard, a filter, a function, string concatenation) can only be authored as
// an expression. The same distinction drives the "advanced" indicators (the
// cogwheel dot and the in-tree icon).

/** One step of a parsed accessor path. */
export type PathSegment =
  | { kind: 'key'; name: string }
  | { kind: 'index'; value: number }
  | { kind: 'wildcard' };

// A single accessor step: `.key`, `[123]`, or `[*]`. Anything else (a filter
// predicate `[x=1]`, a function call, an operator) makes the whole expression
// non-plain and is rejected by the parser.
const STEP = /^(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]|\[\*\])/;

/**
 * Parse a JSONata accessor expression (`$.items[*].full_name`) into segments.
 * Returns `null` for anything that isn't a plain accessor path — a filter,
 * function, operator or string concat — i.e. the genuinely "advanced" cases
 * that only an expression (not the picker) can express.
 */
export function parseAccessorPath(expr: string): PathSegment[] | null {
  let rest = expr.trim().replace(/^\$/, '');
  const segments: PathSegment[] = [];
  while (rest.length > 0) {
    const m = STEP.exec(rest);
    if (!m) {
      return null;
    }
    if (m[1] !== undefined) {
      segments.push({ kind: 'key', name: m[1] });
    } else if (m[2] !== undefined) {
      segments.push({ kind: 'index', value: Number(m[2]) });
    } else {
      segments.push({ kind: 'wildcard' });
    }
    rest = rest.slice(m[0].length);
  }
  return segments;
}

/**
 * Whether an expression is "advanced" — it can't be represented by the field
 * picker, so the editor must stay in Expression mode and flag it. True when the
 * expression is non-empty and either isn't a plain accessor path (filters,
 * functions, operators) or selects a *set* via an array wildcard (`[*]`), which
 * the picker's single-field options can't stand in for.
 */
export function isAdvancedExpression(expr: string | undefined): boolean {
  const trimmed = expr?.trim();
  if (!trimmed) {
    return false;
  }
  const segments = parseAccessorPath(trimmed);
  if (!segments) {
    return true;
  }
  return segments.some(s => s.kind === 'wildcard');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walk the remaining segments after a wildcard down to a primitive, so we can
 * find which array element produced the matched value. */
function leafAtSegments(
  node: unknown,
  segments: PathSegment[],
): string | undefined {
  let cur: unknown = node;
  for (const seg of segments) {
    if (seg.kind === 'key') {
      cur = isRecord(cur) ? cur[seg.name] : undefined;
    } else if (seg.kind === 'index') {
      cur = Array.isArray(cur) ? cur[seg.value] : undefined;
    } else {
      cur = Array.isArray(cur) ? cur[0] : undefined;
    }
    if (cur == null) {
      return undefined;
    }
  }
  return typeof cur === 'object' ? undefined : String(cur);
}

/**
 * Resolve an accessor expression to a concrete key path into `data` for
 * highlighting in the object tree — the key insight being that array steps
 * (`[*]`/`[n]`) resolve to a real element index so a match nested inside an
 * array expands and highlights rather than staying collapsed. A wildcard picks
 * the element whose value equals `matchedValue` (the value the two sides
 * actually joined on) when known, else the first element. Returns `undefined`
 * for expressions that aren't accessor paths (a filter/function selects
 * something no single path can point at).
 */
export function resolveHighlightPath(
  expr: string | undefined,
  data: unknown,
  matchedValue?: string,
): string[] | undefined {
  const trimmed = expr?.trim();
  if (!trimmed) {
    return undefined;
  }
  const segments = parseAccessorPath(trimmed);
  if (!segments || segments.length === 0) {
    return undefined;
  }
  const out: string[] = [];
  let node: unknown = data;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[Number(i)]!;
    if (seg.kind === 'key') {
      node = isRecord(node) ? node[seg.name] : undefined;
      out.push(seg.name);
    } else if (seg.kind === 'index') {
      node = Array.isArray(node) ? node[seg.value] : undefined;
      out.push(String(seg.value));
    } else {
      let index = 0;
      if (Array.isArray(node)) {
        if (matchedValue != null) {
          const found = node.findIndex(
            el => leafAtSegments(el, segments.slice(i + 1)) === matchedValue,
          );
          if (found >= 0) {
            index = found;
          }
        }
        node = node[Number(index)];
      } else {
        node = undefined;
      }
      out.push(String(index));
    }
  }
  return out;
}

/**
 * Split an accessor path into its leaf (last segment) and parent (the rest),
 * for a friendly field-picker label — the leaf is shown as the option/value
 * text and the parent groups it (`$._parent.id` → leaf `id`, parent `_parent`;
 * `$[0].author.login` → leaf `login`, parent `[0].author`).
 */
export function splitFieldPath(path: string): { leaf: string; parent: string } {
  const clean = path.replace(/^\$/, '').replace(/^\./, '').trim();
  if (!clean) {
    return { leaf: '', parent: '' };
  }
  const parts = clean.split('.').filter(Boolean);
  if (parts.length <= 1) {
    return { leaf: clean, parent: '' };
  }
  return {
    leaf: parts[parts.length - 1]!,
    parent: parts.slice(0, -1).join('.'),
  };
}

/** A property picked from the object tree: its key, and whether it sits inside
 * an array (so array steps become `[*]` wildcards, matching any element). */
export interface PickedSegment {
  key: string;
  inArray: boolean;
}

/**
 * Build the JSONata accessor expression for a property picked in the object
 * tree. Object keys become `.key`; a segment sitting inside an array collapses
 * to a `[*]` wildcard so the match applies to any element, not a fixed index
 * (`items` → element → `full_name` ⇒ `$.items[*].full_name`).
 *
 * A *trailing* array step is dropped instead, because `[*]` is a JSONata
 * predicate rather than an array-element wildcard: `*` selects the property
 * values of each element, so it only means "any element" while descending into
 * element objects. On an array of primitives `$.images[*]` evaluates to
 * `undefined` and the rule silently matches nothing — the array path itself is
 * the match target, and JSONata already compares it elementwise.
 */
export function buildFieldExpression(segments: PickedSegment[]): string {
  let expr = '$';
  segments.forEach((seg, i) => {
    if (!seg.inArray) {
      expr += `.${seg.key}`;
    } else if (i < segments.length - 1) {
      expr += '[*]';
    }
  });
  return expr;
}
