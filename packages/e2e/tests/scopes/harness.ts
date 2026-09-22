import type { APIRequestContext } from '@playwright/test';
import { expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * The value sent in `authorization` to represent "the caller holds no relevant
 * scope". It MUST be a non-empty, syntactically-valid scope that matches nothing
 * real: the backend treats an absent or empty header as "grant everything"
 * (`ALL_SCOPES`), so a denial probe that sent an empty header would silently pass
 * as allowed. See packages/backend/src/index.ts.
 */
export const SENTINEL_SCOPE = 'deny:all';

export const SCOPES_HEADER = 'authorization';

/** A scalar equality check, or an explicit operator comparison. */
export type Expectation =
  | number
  | string
  | boolean
  | { operator: '==' | '!='; value: number | string | boolean }
  | { operator: 'in'; value: Array<number | string> };

export interface ApiExpectations {
  status?: Expectation;
  /** Substrings the (JSON) response body must contain, placeholders resolved. */
  bodyIncludes?: string[];
  /** Substrings the response body must NOT contain (row-level filtering). */
  bodyExcludes?: string[];
}

export interface ApiRow {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  url: string;
  body?: unknown;
  scopes: string[];
  expectations: ApiExpectations;
}

export interface McpExpectations {
  /** Whether the tool is advertised in tools/list under these scopes. */
  listed?: boolean;
  /** Whether a tools/call returns an error result. */
  isError?: boolean;
  /** Substrings the call result content must contain (placeholders resolved). */
  contentIncludes?: string[];
  /**
   * Substrings the call result content must NOT contain. Use
   * `contentExcludes: ['insufficient scope']` for a scope-allowed call that may
   * still fail on business logic — it asserts the guard passed without requiring
   * the call to actually succeed. Also used for row-level filtering (a narrowed
   * grant's result excludes the sibling it wasn't granted).
   */
  contentExcludes?: string[];
}

export interface McpRow {
  tool: string;
  args?: Record<string, unknown>;
  scopes: string[];
  /** Path under /api/mcp/v1 (default '/' — the union of enabled servers). */
  server?: string;
  expectations: McpExpectations;
}

export interface AreaSpec {
  api?: ApiRow[];
  mcp?: McpRow[];
}

/** The seeded-fixture map; keys look like `action_1`, values carry `id` etc. */
export type Fixtures = Record<string, Record<string, string>>;

/**
 * Resolve `{{a.b}}` placeholders against the fixture map. Recurses through
 * objects/arrays; leaves non-string leaves untouched. Throws on an unknown
 * placeholder so a typo fails loudly rather than probing a literal `{{...}}` URL.
 */
export function resolvePlaceholders<T>(value: T, fixtures: Fixtures): T {
  if (typeof value === 'string') {
    return value.replace(/\{\{([^}]+)\}\}/g, (_m, path: string) => {
      const [group, field] = path.trim().split('.');
      const entry = fixtures[`${group}`];
      const resolved = entry?.[`${field}`];
      if (resolved === undefined) {
        throw new Error(`Unresolved fixture placeholder: {{${path.trim()}}}`);
      }
      return resolved;
    }) as T;
  }
  if (Array.isArray(value)) {
    return value.map(v => resolvePlaceholders(v, fixtures)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        resolvePlaceholders(v, fixtures),
      ]),
    ) as T;
  }
  return value;
}

/** Header value for a scope list: the sentinel when empty (never an empty header). */
export function scopesHeader(scopes: string[]): string {
  return `Bearer ${scopes.length ? scopes.join(',') : SENTINEL_SCOPE}`;
}

function assertExpectation(
  label: string,
  actual: unknown,
  expected: Expectation,
): void {
  if (
    typeof expected === 'number' ||
    typeof expected === 'string' ||
    typeof expected === 'boolean'
  ) {
    expect(actual, `${label} == ${String(expected)}`).toBe(expected);
    return;
  }
  if (expected.operator === '==') {
    expect(actual, `${label} == ${String(expected.value)}`).toBe(
      expected.value,
    );
  } else if (expected.operator === '!=') {
    expect(actual, `${label} != ${String(expected.value)}`).not.toBe(
      expected.value,
    );
  } else {
    expect(
      expected.value as Array<number | string>,
      `${label} in ${JSON.stringify(expected.value)}`,
    ).toContain(actual);
  }
}

/** Run one REST row: send the request under its scopes, assert expectations. */
export async function runApiRow(
  request: APIRequestContext,
  baseUrl: string,
  row: ApiRow,
  fixtures: Fixtures,
): Promise<void> {
  const url = resolvePlaceholders(row.url, fixtures);
  const body = row.body ? resolvePlaceholders(row.body, fixtures) : undefined;
  const headerValue = scopesHeader(resolvePlaceholders(row.scopes, fixtures));

  const response = await request[row.method](`${baseUrl}${url}`, {
    headers: { [SCOPES_HEADER]: headerValue },
    ...(body !== undefined ? { data: body } : {}),
  });

  const text = await response.text();
  const label = `${row.method.toUpperCase()} ${url} [${headerValue}]`;

  if (row.expectations.status !== undefined) {
    assertExpectation(
      `${label} status`,
      response.status(),
      row.expectations.status,
    );
  }
  for (const needle of resolvePlaceholders(
    row.expectations.bodyIncludes ?? [],
    fixtures,
  )) {
    expect(text, `${label} body includes "${needle}"`).toContain(needle);
  }
  for (const needle of resolvePlaceholders(
    row.expectations.bodyExcludes ?? [],
    fixtures,
  )) {
    expect(text, `${label} body excludes "${needle}"`).not.toContain(needle);
  }
}

/** Run one MCP row against a streamable server, asserting listing + call result. */
export async function runMcpRow(
  mcpBaseUrl: string,
  row: McpRow,
  fixtures: Fixtures,
): Promise<void> {
  const server = row.server ?? '/';
  const url = new URL(`${mcpBaseUrl}${server === '/' ? '' : server}`);
  const client = new Client({ name: 'scopes-e2e', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: {
        [SCOPES_HEADER]: scopesHeader(
          resolvePlaceholders(row.scopes, fixtures),
        ),
      },
    },
  });

  try {
    await client.connect(transport);
    const label = `MCP ${row.tool} [${scopesHeader(row.scopes)}]`;

    if (row.expectations.listed !== undefined) {
      // When every tool is hidden the server drops the `tools` capability
      // entirely, so `tools/list` rejects with -32601 rather than returning an
      // empty list. Treat that as "nothing listed" so denial asserts uniformly.
      const tools = await client
        .listTools()
        .then(r => r.tools)
        .catch(() => [] as Array<{ name: string }>);
      const names = tools.map(t => t.name);
      if (row.expectations.listed) {
        expect(names, `${label} advertised`).toContain(row.tool);
      } else {
        expect(names, `${label} hidden`).not.toContain(row.tool);
      }
    }

    const wantsCall =
      row.expectations.isError !== undefined ||
      row.expectations.contentIncludes !== undefined ||
      row.expectations.contentExcludes !== undefined;

    if (wantsCall) {
      // A hidden tool may reject the call outright rather than returning an
      // error result; treat a thrown rejection as an error result carrying the
      // rejection message so both denial modes assert uniformly.
      const result = await client
        .callTool({
          name: row.tool,
          arguments: resolvePlaceholders(row.args ?? {}, fixtures),
        })
        .catch((e: unknown) => ({
          isError: true,
          content: [
            { type: 'text', text: e instanceof Error ? e.message : String(e) },
          ],
        }));

      const contentText = JSON.stringify(result.content);
      if (row.expectations.isError !== undefined) {
        expect(Boolean(result.isError), `${label} isError`).toBe(
          row.expectations.isError,
        );
      }
      for (const needle of resolvePlaceholders(
        row.expectations.contentIncludes ?? [],
        fixtures,
      )) {
        expect(contentText, `${label} content includes "${needle}"`).toContain(
          needle,
        );
      }
      for (const needle of resolvePlaceholders(
        row.expectations.contentExcludes ?? [],
        fixtures,
      )) {
        expect(
          contentText,
          `${label} content excludes "${needle}"`,
        ).not.toContain(needle);
      }
    }
  } finally {
    await client.close().catch(() => {});
  }
}
