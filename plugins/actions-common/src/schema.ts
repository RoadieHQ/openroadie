import { v4 as uuidv4 } from 'uuid';
import type { ActionMode, ActionParam, JsonSchema, ParamType } from './types';

/**
 * Global functions callable from templates as `{{fn()}}`. Each is invoked fresh
 * for every occurrence, so `{{uuidv4()}}` yields a distinct value each time it
 * appears. They take no arguments and read nothing from `inputs`.
 */
const TEMPLATE_FUNCTIONS: Record<string, () => unknown> = {
  uuidv4: () => uuidv4(),
};

/** A token that is a zero-arg call to a global function, e.g. `uuidv4()`. */
const FUNCTION_CALL = /^([A-Za-z_]\w*)\(\)$/;

/**
 * Resolve a `{{...}}` token to its value: a registered global-function call
 * (`fn()`) is invoked, anything else is looked up in `inputs`. A token shaped
 * like a function call that names no registered function throws — rendering it
 * silently (as empty/null) would let a typo like `{{uuid4()}}` ship and the
 * action still "succeed". Genuinely missing plain inputs return `undefined`
 * so each caller applies its own rendering for missing values.
 */
function resolveToken(
  rawName: string,
  inputs: Record<string, unknown>,
): unknown {
  const name = rawName.trim();
  const call = FUNCTION_CALL.exec(name);
  if (call) {
    const fn = TEMPLATE_FUNCTIONS[call[1]];
    if (!fn) {
      throw new Error(
        `Unknown template function: ${call[1]}() (available: ${Object.keys(
          TEMPLATE_FUNCTIONS,
        )
          .map(n => `${n}()`)
          .join(', ')})`,
      );
    }
    return fn();
  }
  return inputs[name];
}

/** A `{{...}}` token located in a template. `expr` is the trimmed content. */
export interface TemplateToken {
  start: number;
  end: number;
  expr: string;
}

/**
 * Locate `{{...}}` tokens with balanced-brace scanning so jsonata expressions
 * containing braces survive intact: a token closes at the first `}}` seen at
 * inner-brace depth 0; an unterminated token is left as literal text.
 */
export function findTemplateTokens(template: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let i = template.indexOf('{{');
  while (i !== -1) {
    let j = i + 2;
    let depth = 0;
    let closed = -1;
    while (j < template.length) {
      const c = template[j];
      if (c === '{') {
        depth += 1;
      } else if (c === '}') {
        if (depth === 0 && template[j + 1] === '}') {
          closed = j;
          break;
        }
        if (depth > 0) {
          depth -= 1;
        }
      }
      j += 1;
    }
    if (closed === -1) {
      break;
    }
    tokens.push({
      start: i,
      end: closed + 2,
      expr: template.slice(i + 2, closed).trim(),
    });
    i = template.indexOf('{{', closed + 2);
  }
  return tokens;
}

/**
 * Compile an action's flat parameter list into a JSON Schema describing the
 * `inputs` object. Never stored — recomputed (cheaply) wherever needed.
 */
export function compileInputSchema(params: ActionParam[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const param of params) {
    properties[param.name] = compileParam(param);
    if (param.required) {
      required.push(param.name);
    }
  }

  const schema: JsonSchema = { type: 'object', properties };
  if (required.length > 0) {
    schema.required = required;
  }
  return schema;
}

function compileParam(param: ActionParam): JsonSchema {
  const schema: JsonSchema =
    param.type === 'array<string>'
      ? { type: 'array', items: { type: 'string' } }
      : { type: param.type };

  if (param.description) {
    schema.description = param.description;
  }
  if (param.default !== undefined && !param.required) {
    schema.default = param.default;
  }
  return schema;
}

/**
 * Derive mode from steps: HTTP GET and known AWS read operations are 'read';
 * empty, unknown, or mixed steps derive 'write'.
 */
export function deriveActionMode(
  steps: Array<{
    request:
      | { backendType?: 'http'; method: string }
      | { backendType: 'aws'; operation?: string; method: string };
  }>,
): ActionMode {
  return steps.length > 0 &&
    steps.every(step =>
      step.request.backendType === 'aws'
        ? /^(Get|List|Describe)/.test(step.request.operation ?? '')
        : step.request.method === 'GET',
    )
    ? 'read'
    : 'write';
}

/**
 * Derive a URL-safe slug from a free-text name. Mirrors the regex enforced by
 * the backend (`^[a-z0-9]+(-[a-z0-9]+)*$`); shared so UI and backend agree.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Substitute `{{name}}` tokens in a template with values from `inputs`.
 *
 * - Literal substitution only — no conditionals or logic.
 * - `{{fn()}}` invokes a global template function (e.g. `{{uuidv4()}}`);
 *   an unregistered function name throws.
 * - Missing / unknown input tokens render to an empty string.
 * - Scalars substitute raw; objects/arrays substitute as `JSON.stringify`.
 * - `encode`, when supplied, transforms each substituted value before it is
 *   spliced in. Pass `encodeURIComponent` when rendering into a URL path so
 *   input values cannot escape their segment (e.g. `../` traversal, an
 *   injected query string, or an absolute URL changing the target endpoint).
 *
 * Use {@link renderJsonTemplate} for JSON request bodies — raw substitution
 * there lets a string input break out of its quotes and inject JSON.
 */
export function renderTemplate(
  template: string,
  inputs: Record<string, unknown>,
  encode?: (value: string) => string,
): string {
  let out = '';
  let last = 0;
  for (const token of findTemplateTokens(template)) {
    out += template.slice(last, token.start);
    const value = resolveToken(token.expr, inputs);
    if (value !== undefined && value !== null) {
      const rendered =
        typeof value === 'object' ? JSON.stringify(value) : String(value);
      out += encode ? encode(rendered) : rendered;
    }
    last = token.end;
  }
  return out + template.slice(last);
}

/**
 * Substitute `{{name}}` tokens for a JSON body template. Each token is emitted
 * as a complete, self-quoting JSON value, so a string input can never break out
 * of its quotes to corrupt or inject into the surrounding JSON:
 *
 * - Write tokens UNQUOTED — `{"name":{{name}}}`, not `{"name":"{{name}}"}`.
 *   The value brings its own quoting (matching how arrays already render).
 * - Strings render as escaped JSON strings; numbers/booleans/arrays/objects
 *   render as their JSON form; missing/unknown tokens render as `null`.
 * - `{{fn()}}` invokes a global template function (e.g. `{{uuidv4()}}`); its
 *   result is emitted as a self-quoting JSON value like any other input.
 *   An unregistered function name throws.
 */
export function renderJsonTemplate(
  template: string,
  inputs: Record<string, unknown>,
): string {
  let out = '';
  let last = 0;
  for (const token of findTemplateTokens(template)) {
    out += template.slice(last, token.start);
    const value = resolveToken(token.expr, inputs);
    // undefined isn't valid JSON output; render omitted inputs as null.
    out += value === undefined ? 'null' : JSON.stringify(value);
    last = token.end;
  }
  return out + template.slice(last);
}

/**
 * Build a sample `inputs` object from a parameter list, used to prefill the
 * test-runner JSON editor. Every declared param is included.
 */
export function buildSampleInput(
  params: ActionParam[],
): Record<string, unknown> {
  const sample: Record<string, unknown> = {};
  for (const param of params) {
    sample[param.name] =
      param.default !== undefined ? param.default : sampleValue(param.type);
  }
  return sample;
}

function sampleValue(type: ParamType): unknown {
  switch (type) {
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array<string>':
      return [''];
    default:
      return null;
  }
}
