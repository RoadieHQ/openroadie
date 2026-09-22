import { QueryClient } from '@tanstack/react-query';
import { getAppWarmupTier, type AppWarmupTier } from '../app-warmup-policy';

export function queryCacheGcTime(tier: AppWarmupTier) {
  if (tier === 'off') {
    return 5 * 60_000;
  }
  if (tier === 'primary') {
    return 30 * 60_000;
  }
  return Infinity;
}

export function createQueryClient(
  tier: AppWarmupTier = getAppWarmupTier(),
): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: queryCacheGcTime(tier),
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}
