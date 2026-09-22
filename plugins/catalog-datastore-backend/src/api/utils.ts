import { validate as isUuid } from 'uuid';

function isUsefulErrorMessage(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() !== '' &&
    value !== '[object Object]'
  );
}

export function serializeCaughtError(error: unknown): string {
  if (isUsefulErrorMessage(error)) {
    return error;
  }
  if (error instanceof Error && isUsefulErrorMessage(error.message)) {
    return error.name && error.name !== 'Error'
      ? `${error.name}: ${error.message}`
      : error.message;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    !(error instanceof Error)
  ) {
    const nestedMessage = (error as { message?: unknown }).message;
    if (isUsefulErrorMessage(nestedMessage)) {
      return nestedMessage;
    }
  }
  if (typeof error === 'object' && error !== null) {
    try {
      const json = JSON.stringify(
        error,
        error instanceof Error
          ? Object.getOwnPropertyNames(error).filter(name => name !== 'stack')
          : undefined,
      );
      if (json && json !== '{}' && json !== '[object Object]') {
        return json;
      }
    } catch {
      return error instanceof Error && error.name
        ? error.name
        : 'Unknown error';
    }
  }
  if (error instanceof Error && error.name) {
    return error.name;
  }
  return 'Unknown error';
}

export function parsePositiveInt(value: unknown): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = parseInt(value as string, 10);
  if (isNaN(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

/**
 * Comma-separated uuid list query param. Returns `{ ok: false }` on any
 * non-uuid entry, `ids: undefined` when the param is absent/empty (= no
 * filter).
 */
export function parseCsvUuidsParam(
  value: unknown,
): { ok: true; ids?: string[] } | { ok: false } {
  if (value === undefined) {
    return { ok: true };
  }
  if (typeof value !== 'string') {
    return { ok: false };
  }
  const ids = value
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return { ok: true };
  }
  if (ids.some(id => !isUuid(id))) {
    return { ok: false };
  }
  return { ok: true, ids };
}

/** Comma-separated free-text list query param (trimmed, empties dropped). */
export function parseCsvStringsParam(value: unknown): string[] | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const items = value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * Integer query param clamped to [min, max]; `fallback` when absent,
 * undefined when present but not a number (caller 400s).
 */
export function parseClampedIntParam(
  value: unknown,
  options: { min: number; max: number; fallback: number },
): number | undefined {
  if (value === undefined) {
    return options.fallback;
  }
  const parsed = parseInt(value as string, 10);
  if (isNaN(parsed)) {
    return undefined;
  }
  return Math.min(options.max, Math.max(options.min, parsed));
}
