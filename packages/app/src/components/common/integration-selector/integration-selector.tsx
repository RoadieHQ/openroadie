import React, { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Spinner } from '@roadiehq/ui/spinner';
import { Alert, AlertDescription } from '@roadiehq/ui/alert';
import { Badge } from '@roadiehq/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@roadiehq/ui/tooltip';
import { IntegrationLogo, IntegrationIconFrame } from '@roadiehq/ui/item-list';
import type { WorkflowClient } from '../../../api';
import { IntegrationFormDialog } from '../../integrations/form';
import type { Integration } from '../../integrations/types';
import { useIntegrations } from '../../integrations/use-integrations';
import { RequiredSecretsPanel } from '../../integrations/form/required-secrets-panel';
import {
  useIntegrationSecretStatus,
  useInvalidateIntegrationSecretStatus,
} from '../../integrations/use-integration-secret-status';
import { queryKeys } from '../../../api/queries';
import type { IntegrationLike } from '../../integrations/form/use-integration-form';
import { isSecretsReadyForList } from '../../integrations/secret-readiness';
import { IntegrationCapabilityBadges } from './integration-capability-badges';
import { PickerCombobox, type PickerComboboxGroup } from '../picker-combobox';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../../api/workspace-scope';

const INTEGRATION_BACKEND_TYPES = [
  'http',
  'aws',
] as const satisfies ReadonlyArray<Integration['backendType']>;

/** Probe stub used only to discover which backend types a filter accepts. */
const BACKEND_TYPE_PROBE: Omit<Integration, 'backendType'> = {
  id: '__probe__',
  name: '',
  slug: '',
  type: 'other',
  host: '',
  authType: 'none',
  config: {},
  createdBy: 'user',
  createdAt: '',
  updatedAt: '',
  logoUrl: '',
};

function resolveCreateBackendType(
  createBackendType: Integration['backendType'] | undefined,
  integrationFilter: ((integration: Integration) => boolean) | undefined,
): Integration['backendType'] | undefined {
  if (createBackendType) return createBackendType;
  if (!integrationFilter) return undefined;
  const allowed = INTEGRATION_BACKEND_TYPES.filter(backendType =>
    integrationFilter({ ...BACKEND_TYPE_PROBE, backendType }),
  );
  return allowed.length === 1 ? allowed[0] : undefined;
}

interface IntegrationSelectorProps {
  selectedIntegrationId?: string;
  onSelect: (integration: Integration) => void;
  inputAdornment?: React.ReactNode;
  /**
   * Decoupled mode: render these integrations instead of fetching. When
   * omitted, the selector fetches through `listClient` if given, or the shared
   * `useIntegrations` hook otherwise.
   */
  integrations?: Integration[];
  /**
   * Owner-supplied API client for the list fetch (e.g. the data-source editor's
   * workflow client). When provided and `integrations` is omitted, the list is
   * fetched through it under the app-wide `integrationsList` key so it dedupes
   * with the rest of the app. Omit to fall back to `useIntegrations`.
   */
  listClient?: WorkflowClient;
  /** Restrict the offered integrations (e.g. HTTP-only for actions/sources). */
  integrationFilter?: (integration: Integration) => boolean;
  getDisabledReason?: (integration: Integration) => string | undefined;
  unavailableGroupLabel?: string;
  label?: string;
  disabled?: boolean;
  /** Auto-focus and open the dropdown on mount (e.g. a fresh editor draft). */
  autoFocusOnMount?: boolean;
  /** Extra option groups appended after the integration groups. */
  extraGroups?: PickerComboboxGroup[];
  /** Called when a selected option id belongs to an extra group. */
  onSelectExtra?: (id: string) => void;
  /**
   * Called after the inline secrets panel reports a change, in addition to the
   * built-in cache invalidation — lets an owner refresh its own derived state
   * (e.g. the editor's selected-integration query nonce).
   */
  onSecretsRefreshed?: () => void;
  /**
   * When set, inline create starts with this backend type and locks the
   * backend field so users cannot pick an unsupported integration.
   * When omitted but `integrationFilter` accepts exactly one backend type,
   * that type is inferred and locked the same way.
   */
  createBackendType?: Integration['backendType'];
}

export function IntegrationSelector({
  selectedIntegrationId,
  onSelect,
  inputAdornment,
  integrations: externalIntegrations,
  listClient,
  integrationFilter,
  getDisabledReason,
  unavailableGroupLabel = 'Unavailable',
  label = 'Integration',
  disabled,
  autoFocusOnMount = false,
  extraGroups,
  onSelectExtra,
  onSecretsRefreshed,
  createBackendType,
}: IntegrationSelectorProps) {
  const useHookFallback = !listClient && externalIntegrations === undefined;
  const fallback = useIntegrations({ skip: !useHookFallback });
  const queryClient = useQueryClient();
  const workspaceScopeKey = getWorkspaceScopeKey();
  const invalidateSecretStatus = useInvalidateIntegrationSecretStatus();

  // Client-fetch path: fetch the integration list through React Query, reusing
  // the app-wide `integrationsList` key so it dedupes with the rest of the app.
  // Disabled when integrations come from props or the useIntegrations fallback.
  const clientEnabled = !!listClient && externalIntegrations === undefined;
  const contextQuery = useQuery({
    queryKey: queryKeys.integrationsList,
    queryFn: () => {
      if (!listClient) {
        throw new Error('IntegrationSelector: no list client provided');
      }
      return listClient.integrations.list({ limit: 1000 });
    },
    enabled: clientEnabled,
  });
  const fetchedIntegrations = contextQuery.data?.data;

  // Integrations created inline via the dialog; merged so a just-created
  // integration resolves immediately even when the list comes from props.
  const [createdIntegrations, setCreatedIntegrations] = useState<Integration[]>(
    [],
  );
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const effectiveCreateBackendType = useMemo(
    () => resolveCreateBackendType(createBackendType, integrationFilter),
    [createBackendType, integrationFilter],
  );
  const createTemplate = useMemo<Partial<IntegrationLike> | undefined>(
    () =>
      effectiveCreateBackendType
        ? { backendType: effectiveCreateBackendType }
        : undefined,
    [effectiveCreateBackendType],
  );

  const integrations = useMemo(() => {
    const unfilteredBase =
      externalIntegrations ??
      (listClient
        ? (fetchedIntegrations ?? [])
        : (fallback.integrations ?? []));
    const base = integrationFilter
      ? unfilteredBase.filter(integrationFilter)
      : unfilteredBase;
    const extras = createdIntegrations.filter(
      created =>
        (!integrationFilter || integrationFilter(created)) &&
        !base.some(existing => existing.id === created.id),
    );
    return [...base, ...extras].sort((a, b) => a.name.localeCompare(b.name));
  }, [
    externalIntegrations,
    listClient,
    fetchedIntegrations,
    fallback.integrations,
    createdIntegrations,
    integrationFilter,
  ]);

  const loading =
    externalIntegrations !== undefined
      ? false
      : listClient
        ? clientEnabled && contextQuery.isPending
        : fallback.loading;
  const error =
    externalIntegrations !== undefined
      ? null
      : listClient
        ? contextQuery.error
          ? contextQuery.error instanceof Error
            ? contextQuery.error.message
            : 'Failed to load integrations'
          : null
        : (fallback.error?.message ?? null);

  const { summariesByIntegrationId, loading: secretStatusLoading } =
    useIntegrationSecretStatus(integrations);

  const slugCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const integration of integrations) {
      counts.set(integration.slug, (counts.get(integration.slug) ?? 0) + 1);
    }
    return counts;
  }, [integrations]);

  const getIntegrationLabel = useCallback(
    (integration: Integration): string => {
      const displayName = integration.name || integration.host;
      if (
        (slugCounts.get(integration.slug) ?? 0) > 1 &&
        integration.name &&
        integration.host
      ) {
        return `${integration.name} (${integration.host})`;
      }
      return displayName;
    },
    [slugCounts],
  );

  const selectedIntegration = useMemo(
    () => integrations.find(i => i.id === selectedIntegrationId),
    [integrations, selectedIntegrationId],
  );

  const getMissingSecretCount = useCallback(
    (integration: Integration): number => {
      return (
        summariesByIntegrationId.get(integration.id)?.missingSecretRefs
          .length ?? 0
      );
    },
    [summariesByIntegrationId],
  );

  const hasMissingConfiguration = useCallback(
    (integration: Integration): boolean => {
      const summary = summariesByIntegrationId.get(integration.id);
      if (isSecretsReadyForList(integration, summary, secretStatusLoading)) {
        return false;
      }
      return (
        (!!summary && !summary.hasRequiredConfig) ||
        integration.readyForCurrentScope === false ||
        getMissingSecretCount(integration) > 0
      );
    },
    [getMissingSecretCount, secretStatusLoading, summariesByIntegrationId],
  );

  const toOption = useCallback(
    (integration: Integration) => {
      const missingSecretCount = getMissingSecretCount(integration);
      const missingSecretsTooltip =
        missingSecretCount === 1
          ? '1 missing secret'
          : `${missingSecretCount} missing secrets`;
      const missing = hasMissingConfiguration(integration);
      const logo = <IntegrationLogo src={integration.logoUrl} size={20} />;
      return {
        id: integration.id,
        label: getIntegrationLabel(integration),
        disabledReason: getDisabledReason?.(integration),
        icon: (
          <IntegrationIconFrame size="group">
            <IntegrationLogo src={integration.logoUrl} size={16} />
          </IntegrationIconFrame>
        ),
        selectedIcon: missing ? (
          <span className="relative inline-flex">
            {logo}
            <span
              role="img"
              aria-label="Needs setup"
              className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-warning"
            />
          </span>
        ) : (
          logo
        ),
        trailing: (
          <>
            <IntegrationCapabilityBadges integration={integration} />
            {missing &&
              (missingSecretCount > 0 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="warningSubtle"
                      aria-label={missingSecretsTooltip}
                      className="h-5 min-w-5 shrink-0 justify-center rounded-full px-1 py-0 text-[10px] leading-none font-semibold tabular-nums shadow-none"
                    >
                      {missingSecretCount}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    {missingSecretsTooltip}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      aria-label="Missing configuration"
                      className="h-5 min-w-5 shrink-0 justify-center rounded-full px-0 py-0 text-[10px] leading-none font-semibold shadow-none"
                    >
                      !
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    Missing configuration
                  </TooltipContent>
                </Tooltip>
              ))}
          </>
        ),
      };
    },
    [
      getDisabledReason,
      getIntegrationLabel,
      getMissingSecretCount,
      hasMissingConfiguration,
    ],
  );

  const groups = useMemo<PickerComboboxGroup[]>(() => {
    const available = integrations.filter(i => !getDisabledReason?.(i));
    const unavailable = integrations.filter(i => !!getDisabledReason?.(i));
    const configured = available.filter(i => !hasMissingConfiguration(i));
    const missing = available.filter(i => hasMissingConfiguration(i));
    const result: PickerComboboxGroup[] = [];
    if (configured.length > 0) {
      result.push({ label: 'Configured', options: configured.map(toOption) });
    }
    if (missing.length > 0) {
      result.push({
        label: 'Missing configuration',
        options: missing.map(toOption),
      });
    }
    if (unavailable.length > 0) {
      result.push({
        label: unavailableGroupLabel,
        options: unavailable.map(integration => ({
          id: integration.id,
          label: getIntegrationLabel(integration),
          disabledReason: getDisabledReason?.(integration),
          icon: (
            <IntegrationIconFrame size="group">
              <IntegrationLogo src={integration.logoUrl} size={16} />
            </IntegrationIconFrame>
          ),
          selectedIcon: <IntegrationLogo src={integration.logoUrl} size={20} />,
          trailing: <IntegrationCapabilityBadges integration={integration} />,
        })),
      });
    }
    if (extraGroups) {
      result.push(...extraGroups);
    }
    return result;
  }, [
    integrations,
    getDisabledReason,
    hasMissingConfiguration,
    toOption,
    unavailableGroupLabel,
    extraGroups,
    getIntegrationLabel,
  ]);

  const selectedIntegrationSummary = useMemo(
    () =>
      selectedIntegration
        ? summariesByIntegrationId.get(selectedIntegration.id)
        : undefined,
    [selectedIntegration, summariesByIntegrationId],
  );

  const handleSelect = useCallback(
    (id: string) => {
      const integration = integrations.find(i => i.id === id);
      if (integration) {
        if (getDisabledReason?.(integration)) return;
        onSelect(integration);
      } else {
        onSelectExtra?.(id);
      }
    },
    [getDisabledReason, integrations, onSelect, onSelectExtra],
  );

  const handleSecretsChanged = useCallback(() => {
    // Let the owner refresh its own derived state (e.g. the editor's
    // selected-integration query nonce); the list + secret-status caches
    // refresh via invalidation.
    onSecretsRefreshed?.();
    void queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.integrationsList,
        workspaceScopeKey,
      ),
    });
    void invalidateSecretStatus();
  }, [
    onSecretsRefreshed,
    queryClient,
    invalidateSecretStatus,
    workspaceScopeKey,
  ]);

  return (
    <div className="flex flex-col gap-4">
      {loading && (
        <div className="flex items-center gap-2">
          <Spinner size={16} />
          <span className="text-sm text-muted-foreground">
            Loading integrations...
          </span>
        </div>
      )}
      {!loading && error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!loading && !error && (
        <div className="flex items-start gap-3">
          <PickerCombobox
            className="min-w-0 flex-1"
            groups={groups}
            selectedId={selectedIntegrationId}
            onSelect={handleSelect}
            label={label}
            disabled={disabled}
            autoFocusOnMount={autoFocusOnMount}
            footerAction={
              disabled
                ? undefined
                : {
                    label: 'Create new integration',
                    icon: <Plus className="size-4 shrink-0" aria-hidden />,
                    onSelect: () => setCreateDialogOpen(true),
                  }
            }
          />
          {inputAdornment && <div className="shrink-0">{inputAdornment}</div>}
        </div>
      )}
      {selectedIntegration &&
        !isSecretsReadyForList(
          selectedIntegration,
          selectedIntegrationSummary,
          secretStatusLoading,
        ) &&
        (selectedIntegrationSummary?.missingSecretRefs.length ?? 0) > 0 && (
          <RequiredSecretsPanel
            secretRefs={selectedIntegrationSummary?.requiredSecretRefs ?? []}
            onSecretsChanged={handleSecretsChanged}
          />
        )}
      <IntegrationFormDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        template={createTemplate}
        lockCreateBackendType={effectiveCreateBackendType !== undefined}
        onSaved={newIntegration => {
          // Locked create prevents unsupported backends; skip if a filter
          // rejects for non-backend reasons so we never select a mismatch.
          if (integrationFilter && !integrationFilter(newIntegration)) {
            return;
          }
          if (getDisabledReason?.(newIntegration)) return;
          setCreatedIntegrations(prev => [...prev, newIntegration]);
          onSelect(newIntegration);
        }}
      />
    </div>
  );
}
