export function toSecretVariable(secretName: string): string {
  return `\${${secretName}}`;
}

export function extractSecretName(secretValue?: string): string | undefined {
  const match = secretValue?.match(/^\$\{([^}]+)\}$/);
  return match?.[1];
}

export function getSecretOptionNames(
  secretOptions: string[],
  currentValue?: string,
): string[] {
  const currentSecretName = extractSecretName(currentValue);
  if (!currentSecretName || secretOptions.includes(currentSecretName)) {
    return secretOptions;
  }
  return [currentSecretName, ...secretOptions];
}
