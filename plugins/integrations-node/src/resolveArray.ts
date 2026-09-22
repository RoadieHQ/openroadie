export function findAllArraysInObject(
  obj: unknown,
  path: string[] = [],
  maxDepth: number = 3,
): Array<{ path: string[]; array: unknown[] }> {
  if (Array.isArray(obj)) {
    return [{ path, array: obj }];
  }

  if (maxDepth <= 0) {
    return [];
  }

  if (typeof obj === 'object' && obj !== null) {
    const results: Array<{ path: string[]; array: unknown[] }> = [];
    for (const [key, value] of Object.entries(obj)) {
      results.push(
        ...findAllArraysInObject(value, [...path, key], maxDepth - 1),
      );
    }
    return results;
  }

  return [];
}

export async function detectArrayInResponse(
  obj: object,
  log: (message: string) => void,
): Promise<unknown[] | null> {
  const record = obj as Record<string, unknown>;

  const commonArrayKeys = [
    'items',
    'data',
    'results',
    'records',
    'entries',
    'list',
    'values',
    'objects',
    'rows',
    'nodes',
    'edges',
    'content',
    'response',
    'payload',
  ];
  for (const key of commonArrayKeys) {
    if (Array.isArray(record[key])) {
      log(`Auto-detected array at key "${key}" in response`);
      return record[key] as unknown[];
    }
  }

  const foundArrays = findAllArraysInObject(obj);
  if (foundArrays.length === 1) {
    const { path, array } = foundArrays[0];
    log(`Auto-detected single array at path "${path.join('.')}" in response`);
    return array;
  }

  if (foundArrays.length > 1) {
    const sorted = foundArrays.sort((a, b) => b.array.length - a.array.length);
    const largest = sorted[0];
    if (largest.array.length > 0) {
      log(
        `Auto-detected largest array at path "${largest.path.join('.')}" (${
          largest.array.length
        } items) in response`,
      );
      return largest.array;
    }
  }

  return null;
}
