import jsonataSafe from '@roadiehq/jsonata-safe';

export const jsonata = (expression: string) =>
  jsonataSafe(expression, {
    allowLambdas: false,
    allowedFunctions: ['lowercase'],
  });

export function normalizeFieldValues(value: unknown): string[] {
  if (typeof value === 'string' && value) {
    return [value];
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap(v => normalizeFieldValues(v));
  }
  return [];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
