import React, {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSecrets } from '../../api';
import { secretStorageModeQuery } from '../../api/queries';
import type { StorageMode } from '../../api/secrets';

interface ContextValue {
  storageMode: StorageMode | undefined;
  readOnly: boolean;
  loading: boolean;
}

export const SecretSettingsContext = createContext<ContextValue>({
  storageMode: undefined,
  readOnly: false,
  loading: false,
});

// An unreachable storage-mode endpoint degrades to the writable dotenv
// default rather than blocking the secrets page.
const DOTENV_FALLBACK: StorageMode = { mode: 'dotenv', readOnly: false };

export function SecretSettingsProvider({ children }: PropsWithChildren) {
  const secretsClient = useSecrets();
  const { data, isLoading, isError } = useQuery(
    secretStorageModeQuery(secretsClient),
  );

  const storageMode = isError ? DOTENV_FALLBACK : data;

  const value = useMemo<ContextValue>(
    () => ({
      storageMode,
      readOnly: storageMode?.readOnly ?? false,
      loading: isLoading,
    }),
    [storageMode, isLoading],
  );

  return (
    <SecretSettingsContext.Provider value={value}>
      {children}
    </SecretSettingsContext.Provider>
  );
}

export function useSecretSettings(): ContextValue {
  return useContext(SecretSettingsContext);
}
