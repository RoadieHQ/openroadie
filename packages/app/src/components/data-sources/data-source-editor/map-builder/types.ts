export type MapOverrideSource =
  | {
      kind: 'literal';
      valueType: 'string' | 'number' | 'boolean' | 'null';
      value: string | number | boolean | null;
    }
  | { kind: 'field'; path: string }
  | { kind: 'expression'; expression: string };

export interface MapOverride {
  id: string;
  targetPath: string;
  source: MapOverrideSource;
}

export interface MapRules {
  passthrough: boolean;
  /**
   * Top-level input keys to drop from the passthrough. Only applied when
   * `passthrough` is true. Useful for stripping noisy/large fields from the
   * source (e.g. `permissions`, `description`) before merging overrides.
   *
   * v1 supports top-level keys only. Nested omits should use Advanced mode.
   */
  omit?: string[];
  overrides: MapOverride[];
}

/**
 * Generates a unique override ID. Uses `crypto.randomUUID()` when available
 * (browsers and Node 14.17+); otherwise falls back to time + random base36.
 *
 * No module-level mutable state — the previous incrementing counter leaked
 * across tests (changing test order changed IDs) and would have leaked
 * across requests if the module were ever loaded in an SSR context.
 */
export function nextOverrideId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `mo-${globalThis.crypto.randomUUID()}`;
  }
  const rand =
    Math.random().toString(36).slice(2, 8) +
    Math.random().toString(36).slice(2, 8);
  return `mo-${Date.now().toString(36)}-${rand}`;
}
