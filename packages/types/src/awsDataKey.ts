export function deriveAwsDataKey(config: Record<string, unknown>): string {
  if (config.mode === 'service-api') {
    if (typeof config.operation === 'string' && config.operation) {
      return config.operation.replace(/[^a-zA-Z0-9]/g, '') || 'data';
    }
    if (typeof config.path === 'string' && config.path) {
      const parts = config.path.split('/').filter(Boolean);
      const last = parts[parts.length - 1] ?? 'data';
      return last.replace(/[^a-zA-Z0-9]/g, '') || 'data';
    }
    return 'data';
  }
  if (typeof config.resourceType !== 'string') {
    return 'resources';
  }
  const parts = config.resourceType.split(':').filter(Boolean);
  return parts[parts.length - 1] ?? 'resources';
}
