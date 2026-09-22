import React from 'react';
import { flushSync } from 'react-dom';
import { RouterProvider } from 'react-router';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { Toaster } from '@roadiehq/ui/toaster';
import { ServiceWorkerUpdater } from './components/service-worker-updater';
import { EntityChangeSubscriber } from './components/entity-change-subscriber';
import { NavigationIntentProvider } from './components/common/navigation-intent-link';
import { WorkspaceProvider } from './components/workspaces';
import { AppDataWarmup } from './components/app-data-warmup';

import type { ApiClients } from './api';
import { ApiContext } from './api';
import type { AppRouter } from './app-router';
import type { WarmupPriority } from './warmup-priority';

export function App({
  apis,
  queryClient,
  router,
  warmupPriority,
}: {
  apis: ApiClients;
  queryClient: QueryClient;
  router: AppRouter;
  warmupPriority?: WarmupPriority;
}) {
  return (
    <ApiContext.Provider value={apis}>
      <QueryClientProvider client={queryClient}>
        <WorkspaceProvider navigation={router}>
          <AppDataWarmup queryClient={queryClient} priority={warmupPriority} />
          <EntityChangeSubscriber />
          <NavigationIntentProvider router={router}>
            <RouterProvider flushSync={flushSync} router={router} />
          </NavigationIntentProvider>
        </WorkspaceProvider>
        <Toaster />
        <ServiceWorkerUpdater />
      </QueryClientProvider>
    </ApiContext.Provider>
  );
}
