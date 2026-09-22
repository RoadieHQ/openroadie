import type { QueryClient } from '@tanstack/react-query';
import { useApis, type ApiClients } from '../api';
import { scheduleAppDataWarmup } from '../app-data-warmup';
import { useMountEffect } from '../hooks/use-mount-effect';
import type { WarmupPriority } from '../warmup-priority';

export function AppDataWarmup({
  apis,
  queryClient,
  priority,
}: {
  apis?: ApiClients;
  queryClient: QueryClient;
  priority?: WarmupPriority;
}) {
  const contextApis = useApis();
  const resolvedApis = apis ?? contextApis;
  useMountEffect(() =>
    scheduleAppDataWarmup({
      apis: resolvedApis,
      queryClient,
      priority,
    }),
  );

  return null;
}
