import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAgent } from '../../api';
import { AISettingsDialog } from './ai-settings-dialog';

export type AIProvider = 'openai' | 'anthropic';
export type ProviderSettings = Record<string, string>;

interface AISettingsContextValue {
  selectedProvider: AIProvider | null;
  settings: ProviderSettings | null;
  isLoading: boolean;
  isConfigured: boolean;
  openSettingsDialog: () => void;
  closeSettingsDialog: () => void;
  isDialogOpen: boolean;
  saveSettings: (
    provider: AIProvider,
    settings: ProviderSettings,
  ) => Promise<void>;
}

const AISettingsContext = createContext<AISettingsContextValue | null>(null);

export function useAISettingsContext() {
  const context = useContext(AISettingsContext);
  if (!context) {
    throw new Error(
      'useAISettingsContext must be used within AISettingsProvider',
    );
  }
  return context;
}

function AISettingsProviderInner({ children }: { children: React.ReactNode }) {
  const agent = useAgent();
  const [selectedProvider, setSelectedProvider] = useState<AIProvider | null>(
    null,
  );
  const [settings, setSettings] = useState<ProviderSettings | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const seededRef = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ['aiSettings'],
    queryFn: () => agent.getSettings(),
  });

  // `selectedProvider`/`settings` are a local edit buffer the save path writes
  // to; seed them once from the query's first successful load and never let a
  // background refetch clobber a later local edit.
  useEffect(() => {
    if (data && !seededRef.current) {
      seededRef.current = true;
      setSelectedProvider(data.selectedProvider as AIProvider | null);
      setSettings(data.settings as ProviderSettings | null);
    }
  }, [data]);

  const openSettingsDialog = useCallback(() => {
    setIsDialogOpen(true);
  }, []);

  const closeSettingsDialog = useCallback(() => {
    setIsDialogOpen(false);
  }, []);

  const saveSettings = useCallback(
    async (provider: AIProvider, newSettings: ProviderSettings) => {
      // Persist first: updating local state before the backend confirms would
      // leave the UI showing configuration that was never saved. Store the
      // backend's response, not the request — a partial save omits unchanged
      // (masked) secrets, so `newSettings` can be empty while the response
      // carries the full masked settings the UI needs to stay configured.
      const saved = await agent.saveSettings({
        provider,
        settings: newSettings,
      });
      setSelectedProvider(
        (saved.selectedProvider as AIProvider | null) ?? provider,
      );
      setSettings((saved.settings as ProviderSettings | null) ?? newSettings);
    },
    [agent],
  );

  const isConfigured = selectedProvider !== null && settings !== null;

  const value = useMemo(
    () => ({
      selectedProvider,
      settings,
      isLoading,
      isConfigured,
      openSettingsDialog,
      closeSettingsDialog,
      isDialogOpen,
      saveSettings,
    }),
    [
      selectedProvider,
      settings,
      isLoading,
      isConfigured,
      openSettingsDialog,
      closeSettingsDialog,
      isDialogOpen,
      saveSettings,
    ],
  );

  return (
    <AISettingsContext.Provider value={value}>
      {children}
      <AISettingsDialog />
    </AISettingsContext.Provider>
  );
}

export function AISettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AISettingsProviderInner>{children}</AISettingsProviderInner>;
}
