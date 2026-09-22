export function composeAuthHeaderValue(
  prefix: string | undefined,
  value: string,
): string {
  const rawPrefix = prefix ?? '';
  if (!rawPrefix.trim()) {
    return value;
  }
  return /\s$/.test(rawPrefix)
    ? `${rawPrefix}${value}`
    : `${rawPrefix} ${value}`;
}
