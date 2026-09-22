export function normalizeExecutionOutput(
  output: unknown,
): unknown[] | undefined {
  if (output === undefined) {
    return undefined;
  }

  let normalizedOutput: unknown = output;
  if (
    normalizedOutput &&
    typeof normalizedOutput === 'object' &&
    !Array.isArray(normalizedOutput) &&
    'data' in normalizedOutput
  ) {
    normalizedOutput = (normalizedOutput as Record<string, unknown>).data;
  }

  return Array.isArray(normalizedOutput)
    ? normalizedOutput
    : [normalizedOutput];
}
