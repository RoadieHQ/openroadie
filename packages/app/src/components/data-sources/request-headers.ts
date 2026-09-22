import type { Header } from './data-source-editor/data-source-editor-context';

// Saved node configs hold request headers as a `Record<string, string>` map (see
// `use-data-source-builder`), while the editor works in ordered key/value pairs.
// Hydration has to convert back, or the saved headers disappear from the form:
// `HeadersEditor` coerces a non-array to `[]` and renders its empty state.
export function toHeaderPairs(headers: unknown): Header[] {
  if (Array.isArray(headers)) {
    const rows: unknown[] = headers;
    return rows.flatMap(row => {
      if (!row || typeof row !== 'object') {
        return [];
      }
      const { key, value } = row as { key?: unknown; value?: unknown };
      return typeof key === 'string'
        ? [{ key, value: toHeaderValue(value) }]
        : [];
    });
  }
  if (headers && typeof headers === 'object') {
    return Object.entries(headers as Record<string, unknown>).map(
      ([key, value]) => ({ key, value: toHeaderValue(value) }),
    );
  }
  return [];
}

/**
 * Returns `config` with any saved header map converted to editor pairs. Configs
 * without headers (an AWS Cloud Control source, a filter step) are returned
 * untouched rather than gaining an empty `headers` array that would be written
 * back on the next save.
 */
export function hydrateConfigHeaders(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const { headers } = config;
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return config;
  }
  return { ...config, headers: toHeaderPairs(headers) };
}

function toHeaderValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return value === undefined || value === null ? '' : String(value);
}
