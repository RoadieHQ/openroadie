const DISPLAY_NAME_KEYS = [
  'name',
  'display_name',
  'displayName',
  'title',
  'full_name',
  'login',
  'username',
  'email',
  'slug',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveFromRecord(record: Record<string, unknown>): string | null {
  for (const key of DISPLAY_NAME_KEYS) {
    const value = nonEmptyString(record[`${key}`]);
    if (value) {
      return value;
    }
  }
  return null;
}

export function resolveObjectDisplayNameOrNull(
  objectJson: unknown,
  presentation?: { title?: string },
): string | null {
  if (presentation?.title?.trim()) {
    return presentation.title.trim();
  }

  if (!isRecord(objectJson)) {
    return null;
  }

  const topLevel = resolveFromRecord(objectJson);
  if (topLevel) {
    return topLevel;
  }

  for (const nestedKey of ['profile', 'fields'] as const) {
    const nested = objectJson[`${nestedKey}`];
    if (!isRecord(nested)) {
      continue;
    }
    const nestedName = resolveFromRecord(nested);
    if (nestedName) {
      return nestedName;
    }
  }

  return null;
}

export function resolveObjectDisplayName(
  objectJson: unknown,
  objectId: string,
  presentation?: { title?: string },
): string {
  return resolveObjectDisplayNameOrNull(objectJson, presentation) ?? objectId;
}
