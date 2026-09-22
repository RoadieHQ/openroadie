import type { PaginationConfig } from '@roadiehq/integrations-node';

type PaginationMode = 'inherit' | 'custom' | 'disabled';

interface HttpPaginationConfigShape {
  mode?: unknown;
  pagination?: PaginationConfig;
  paginationMode?: PaginationMode;
  effectivePaginationDefault?: PaginationConfig;
}

export function resolveHttpPagination(
  config: HttpPaginationConfigShape,
  integrationPaginationDefault?: PaginationConfig,
): {
  pagination?: PaginationConfig;
  disableImplicitPagination?: boolean;
} {
  const paginationMode = config.paginationMode;
  const pagination = config.pagination;
  const effectivePaginationDefault =
    config.effectivePaginationDefault ?? integrationPaginationDefault;

  if (config.mode === 'graphql') {
    if (paginationMode === 'disabled') {
      return {
        pagination: { type: 'none' },
        disableImplicitPagination: true,
      };
    }
    if (paginationMode === 'inherit') {
      if (!effectivePaginationDefault) {
        return {};
      }
      return {
        pagination: effectivePaginationDefault,
        disableImplicitPagination:
          effectivePaginationDefault.type === 'none' || undefined,
      };
    }
    return { pagination };
  }

  if (paginationMode === 'custom') {
    return { pagination };
  }

  if (paginationMode === 'disabled') {
    return {
      pagination: { type: 'none' },
      disableImplicitPagination: true,
    };
  }

  if (paginationMode === 'inherit') {
    if (!effectivePaginationDefault) {
      return {};
    }
    return {
      pagination: effectivePaginationDefault,
      disableImplicitPagination:
        effectivePaginationDefault.type === 'none' || undefined,
    };
  }

  return { pagination };
}

export function applyResolvedHttpPagination(
  config: Record<string, unknown>,
  integrationPaginationDefault?: PaginationConfig,
): {
  config: Record<string, unknown>;
  disableImplicitPagination?: boolean;
} {
  const resolved = resolveHttpPagination(
    config as HttpPaginationConfigShape,
    integrationPaginationDefault,
  );

  const nextConfig: Record<string, unknown> = { ...config };
  if (resolved.pagination !== undefined) {
    nextConfig.pagination = resolved.pagination;
  }

  return {
    config: nextConfig,
    disableImplicitPagination: resolved.disableImplicitPagination,
  };
}
