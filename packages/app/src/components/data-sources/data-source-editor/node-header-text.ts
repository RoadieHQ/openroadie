export function truncateNodeLabel(value: string | undefined, max = 44) {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, max - 3)).trim()}...`;
}

export function formatItemCount(count: number | undefined) {
  if (typeof count !== 'number' || Number.isNaN(count)) {
    return '0 items';
  }
  return `${count} item${count === 1 ? '' : 's'}`;
}

function trimSlashes(value: string) {
  let start = 0;
  let end = value.length;
  while (start < end && value.charAt(start) === '/') {
    start++;
  }
  while (end > start && value.charAt(end - 1) === '/') {
    end--;
  }
  return value.slice(start, end);
}

export function getHttpSourceHost(
  config: Record<string, unknown>,
  hostOverride?: unknown,
) {
  return String(
    hostOverride ||
      config.integrationHost ||
      config.integrationName ||
      config.integrationId ||
      '',
  ).trim();
}

export function getServiceApiModeSubtitle(
  config: Record<string, unknown>,
): string | undefined {
  if (config.mode !== 'service-api') {
    return undefined;
  }
  const service = typeof config.service === 'string' ? config.service : '';
  const path = typeof config.path === 'string' ? config.path : '';
  if (service && path) {
    return `${service}:${path}`;
  }
  if (service) {
    return service;
  }
  return undefined;
}

export function formatHttpSourceTitle(
  config: Record<string, unknown>,
  max = 44,
) {
  const method = String(config.method || 'GET').toUpperCase();
  const path = String(config.pathTemplate || config.path || '').trim();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const requestString = `${method} /${trimSlashes(normalizedPath)}`;
  return truncateNodeLabel(requestString, max);
}
