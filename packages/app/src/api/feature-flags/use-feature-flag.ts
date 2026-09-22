import { useQuery } from '@tanstack/react-query';
import { useFeatureFlags } from '../../api';
import { queryKeys } from '../queries';
import { queryFreshness } from '../query-freshness';
import type { FeatureFlagValue } from './feature-flag-client';

export function useFeatureFlag<T extends FeatureFlagValue = FeatureFlagValue>(
  key: string,
  defaultValue: T,
): { value: T; loading: boolean } {
  const client = useFeatureFlags();
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.featureFlag(key, defaultValue),
    queryFn: () => client.getFlag(key, defaultValue),
    ...queryFreshness.deploymentStatic,
    // Seed from the client's sync cache so an already-known flag renders
    // without a loading flicker.
    initialData: client.hasCachedFlags
      ? () => client.getCachedFlag(key, defaultValue)
      : undefined,
  });

  return {
    value: data === undefined ? defaultValue : data,
    loading: isLoading,
  };
}
