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
import {
  Liquid,
  LiquidError,
  filters as builtinFilters,
  type FilterImplOptions,
  type FS,
} from 'liquidjs';
import { ALLOWED_FILTERS, ALLOWED_TAGS } from './allowlist';

type FilterHandler = Extract<FilterImplOptions, CallableFunction>;
type FilterThis = ThisParameterType<FilterHandler>;

/**
 * Async data-access functions exposed to templates as filters (e.g.
 * `{{ member | related: 'owns' }}`). The piped value arrives as the first
 * argument. Callers provide the implementations; liquid-safe wraps them with
 * call budgeting and per-render memoization.
 */
export type LiquidDataFunctions = Record<
  string,
  (...args: unknown[]) => unknown
>;

export interface LiquidRenderBudget {
  /** Hard wall-clock cap for one render, in ms. Default 2000. */
  timeoutMs?: number;
  /** Maximum non-memoized data-function calls per render. Default 100. */
  maxDataCalls?: number;
  /** Maximum length of the rendered output, in characters. Default 1_000_000. */
  maxOutputChars?: number;
  /** LiquidJS allocation cap for one render, in bytes. Default 128 MiB. */
  memoryBytes?: number;
}

export interface LiquidParseIssue {
  message: string;
  /** 1-based line in the template, when the parser can attribute one. */
  line?: number;
  /** 1-based column in the template, when the parser can attribute one. */
  col?: number;
}

export type LiquidBudgetKind = 'timeout' | 'dataCalls' | 'output';

export class LiquidBudgetExceededError extends Error {
  constructor(
    public readonly kind: LiquidBudgetKind,
    message: string,
  ) {
    super(message);
    this.name = 'LiquidBudgetExceededError';
  }
}

const DEFAULT_BUDGET: Required<LiquidRenderBudget> = {
  timeoutMs: 2_000,
  maxDataCalls: 100,
  maxOutputChars: 1_000_000,
  memoryBytes: 128 * 1024 * 1024,
};

/** Templates are inline strings; the partial-loading tags are stripped, so any
 *  path that still reaches the filesystem is a bug — fail loudly. */
const fsBlocked = (): never => {
  throw new Error('File system access is not available in templates');
};
const BLOCKED_FS: FS = {
  exists: async () => fsBlocked(),
  existsSync: fsBlocked,
  readFile: async () => fsBlocked(),
  readFileSync: fsBlocked,
  resolve: fsBlocked,
};

const MAX_TEMPLATE_CHARS = 1_000_000;

/** Cap on the `json` filter's base-indent argument, so a template can't mint
 *  huge pad strings per output line. No real document nests deeper than this. */
const MAX_JSON_BASE_INDENT = 120;

/**
 * The builtin `json` filter emits continuation lines at column 0, so a
 * multi-line value embedded mid-document breaks the surrounding indentation.
 * This override adds an optional second argument — the column the value sits
 * at — which is prefixed to every line after the first, keeping nested JSON
 * aligned with its context: `"data": {{ member.data | json: 2, 6 }}`.
 */
function jsonWithBaseIndent(
  this: FilterThis,
  value: unknown,
  space?: number,
  baseIndent?: number,
): unknown {
  const builtin = builtinFilters.json;
  const text =
    typeof builtin === 'function'
      ? builtin.call(this, value, space)
      : builtin.handler.call(this, value, space);
  const indent = Math.trunc(Number(baseIndent ?? 0));
  if (typeof text !== 'string' || !Number.isFinite(indent) || indent <= 0) {
    return text;
  }
  const pad = ' '.repeat(Math.min(indent, MAX_JSON_BASE_INDENT));
  return text.replace(/\n/g, `\n${pad}`);
}

function createEngine(budget: Required<LiquidRenderBudget>): Liquid {
  const engine = new Liquid({
    // Unknown filters fail at parse time instead of rendering as a no-op.
    strictFilters: true,
    // Missing variables render as nil so `default` fallback chains work.
    strictVariables: false,
    // No inherited-property access (blocks `constructor` / prototype walks).
    ownPropertyOnly: true,
    fs: BLOCKED_FS,
    parseLimit: MAX_TEMPLATE_CHARS,
    renderLimit: budget.timeoutMs,
    memoryLimit: budget.memoryBytes,
  });
  for (const name of Object.keys(engine.tags)) {
    if (!ALLOWED_TAGS.has(name)) delete engine.tags[`${name}`];
  }
  for (const name of Object.keys(engine.filters)) {
    if (!ALLOWED_FILTERS.has(name)) delete engine.filters[`${name}`];
  }
  engine.registerFilter('json', jsonWithBaseIndent);
  return engine;
}

interface BudgetState {
  calls: number;
  memo: Map<string, unknown>;
}

function wrapDataFunction(
  name: string,
  fn: (...args: unknown[]) => unknown,
  state: BudgetState,
  maxDataCalls: number,
) {
  return async (...args: unknown[]): Promise<unknown> => {
    const key = `${name}:${JSON.stringify(args)}`;
    if (state.memo.has(key)) return state.memo.get(key);
    state.calls += 1;
    if (state.calls > maxDataCalls) {
      throw new LiquidBudgetExceededError(
        'dataCalls',
        `Template exceeded the data-call budget of ${maxDataCalls}`,
      );
    }
    const result = await fn(...args);
    state.memo.set(key, result);
    return result;
  };
}

function toParseIssue(e: unknown): LiquidParseIssue {
  if (LiquidError.is(e)) {
    const [line, col] = e.token.getPosition();
    return { message: e.message, line, col };
  }
  return { message: e instanceof Error ? e.message : String(e) };
}

/**
 * Parse-validate a template against the safe engine: syntax errors,
 * disallowed/unknown tags, and disallowed/unknown filters are all reported
 * with their template position. An empty array means the template is
 * renderable. `dataFunctionNames` must list the data filters the render call
 * will provide (defaults to none) so their use doesn't fail validation.
 */
export function validateLiquidTemplate(
  template: string,
  dataFunctionNames: string[] = [],
): LiquidParseIssue[] {
  if (template.length > MAX_TEMPLATE_CHARS) {
    return [
      {
        message: `Template exceeds the maximum size of ${MAX_TEMPLATE_CHARS} characters`,
      },
    ];
  }
  const engine = createEngine(DEFAULT_BUDGET);
  for (const name of dataFunctionNames) {
    engine.registerFilter(name, () => undefined);
  }
  try {
    engine.parse(template);
    return [];
  } catch (e: unknown) {
    return [toParseIssue(e)];
  }
}

export interface LiquidRenderOptions {
  data?: LiquidDataFunctions;
  budget?: LiquidRenderBudget;
}

/**
 * Render a template against a context document inside the sandbox: allowlisted
 * tags/filters only, no filesystem, no prototype access, and a per-render
 * budget on wall-clock time, data-function calls, and output size.
 *
 * The timeout is enforced twice: LiquidJS's cooperative `renderLimit` catches
 * template-driven work (loops), and a wall-clock race catches data functions
 * that hang. The race cannot abort the underlying data call — it only stops
 * waiting for it.
 */
export async function renderLiquidSafe(
  template: string,
  context: object,
  options: LiquidRenderOptions = {},
): Promise<string> {
  const budget = { ...DEFAULT_BUDGET, ...options.budget };
  const engine = createEngine(budget);

  const state: BudgetState = { calls: 0, memo: new Map() };
  for (const [name, fn] of Object.entries(options.data ?? {})) {
    engine.registerFilter(
      name,
      wrapDataFunction(name, fn, state, budget.maxDataCalls),
    );
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new LiquidBudgetExceededError(
            'timeout',
            `Template render exceeded ${budget.timeoutMs}ms`,
          ),
        ),
      budget.timeoutMs,
    );
  });

  try {
    const rendered: string = await Promise.race([
      engine.parseAndRender(template, context),
      timeout,
    ]).catch((e: unknown) => {
      // LiquidJS wraps errors thrown inside filters in a RenderError; surface
      // budget violations under their own type so callers can branch on it.
      if (
        LiquidError.is(e) &&
        e.originalError instanceof LiquidBudgetExceededError
      ) {
        throw e.originalError;
      }
      throw e;
    });
    if (rendered.length > budget.maxOutputChars) {
      throw new LiquidBudgetExceededError(
        'output',
        `Template output exceeded ${budget.maxOutputChars} characters`,
      );
    }
    return rendered;
  } finally {
    clearTimeout(timer);
  }
}
