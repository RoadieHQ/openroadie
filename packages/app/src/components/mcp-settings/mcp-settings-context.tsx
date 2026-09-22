import React, { createContext, useContext, useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMcpSettings, useAppConfig, useAlert } from '../../api';
import type { McpServerSettings } from '../../api/mcp-settings';

const serversKey = ['mcpSettings', 'servers'] as const;

interface McpSettingsContextValue {
  servers: McpServerSettings[];
  isLoading: boolean;
  toggleServer: (id: string, enabled: boolean) => Promise<void>;
  toggleTool: (toolName: string, enabled: boolean) => Promise<void>;
  mcpBaseUrl: string;
}

const McpSettingsContext = createContext<McpSettingsContextValue | null>(null);

export function useMcpSettingsContext() {
  const context = useContext(McpSettingsContext);
  if (!context) {
    throw new Error(
      'useMcpSettingsContext must be used within McpSettingsProvider',
    );
  }
  return context;
}

export function McpSettingsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const client = useMcpSettings();
  const config = useAppConfig();
  const alertApi = useAlert();
  const queryClient = useQueryClient();

  const mcpBaseUrl = `${config.backend.baseUrl}/api/mcp/v1`;

  const { data: servers = [], isLoading } = useQuery({
    queryKey: serversKey,
    queryFn: () => client.getServers(),
  });

  const toggleServerMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      client.setServersEnabled([{ id, enabled }]),
    onMutate: async ({ id, enabled }) => {
      await queryClient.cancelQueries({ queryKey: serversKey });
      const previous =
        queryClient.getQueryData<McpServerSettings[]>(serversKey);
      queryClient.setQueryData<McpServerSettings[]>(serversKey, prev =>
        (prev ?? []).map(s => (s.id === id ? { ...s, enabled } : s)),
      );
      return { previous };
    },
    onError: (e, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(serversKey, context.previous);
      }
      alertApi.post({
        message: e instanceof Error ? e.message : 'Failed to update MCP server',
        severity: 'error',
      });
    },
    onSuccess: updated => {
      queryClient.setQueryData(serversKey, updated);
    },
  });

  const toggleToolMutation = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      client.setToolsEnabled([{ name, enabled }]),
    onMutate: async ({ name, enabled }) => {
      await queryClient.cancelQueries({ queryKey: serversKey });
      const previous =
        queryClient.getQueryData<McpServerSettings[]>(serversKey);
      queryClient.setQueryData<McpServerSettings[]>(serversKey, prev =>
        (prev ?? []).map(s => ({
          ...s,
          tools: s.tools.map(t => (t.name === name ? { ...t, enabled } : t)),
        })),
      );
      return { previous };
    },
    onError: (e, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(serversKey, context.previous);
      }
      alertApi.post({
        message: e instanceof Error ? e.message : 'Failed to update MCP tool',
        severity: 'error',
      });
    },
    onSuccess: updated => {
      queryClient.setQueryData(serversKey, updated);
    },
  });

  // The card awaits these to keep its switch disabled until the mutation
  // settles; error handling (rollback + alert) lives in the mutation's
  // onError, so we swallow the rejection here rather than reject to the card.
  const toggleServer = useCallback(
    (id: string, enabled: boolean) =>
      toggleServerMutation.mutateAsync({ id, enabled }).then(
        () => undefined,
        () => undefined,
      ),
    [toggleServerMutation],
  );

  const toggleTool = useCallback(
    (toolName: string, enabled: boolean) =>
      toggleToolMutation.mutateAsync({ name: toolName, enabled }).then(
        () => undefined,
        () => undefined,
      ),
    [toggleToolMutation],
  );

  const value = useMemo(
    () => ({ servers, isLoading, toggleServer, toggleTool, mcpBaseUrl }),
    [servers, isLoading, toggleServer, toggleTool, mcpBaseUrl],
  );

  return (
    <McpSettingsContext.Provider value={value}>
      {children}
    </McpSettingsContext.Provider>
  );
}
