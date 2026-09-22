import type { StatusIndicatorTone } from '@roadiehq/ui/status-indicator';
import {
  READINESS,
  LIFECYCLE,
  statusValue,
  getToggleActionLabel,
  getToggleActionVerb,
  type LifecycleStatus,
  type OverviewStatusTone,
} from '../overview';
import type { IntegrationSecretSummary } from '../integrations/use-integration-secret-status';
import type { DataSourceItem } from './types';
import {
  getDataSourceReadinessReason,
  getIntegrationReadinessReason,
  isDataSourceConfigurationReady,
  isDataSourceIntegrationReady,
  resolveUnreadyIntegration,
  dataSourceIntegrations,
} from './readiness';

export type DataSourceSetupLabel =
  | typeof READINESS.ready.label
  | typeof READINESS.needsSetup.label
  | typeof READINESS.needsIntegrationSetup.label;

export interface DataSourceSetupStatus {
  tone: OverviewStatusTone;
  label: DataSourceSetupLabel | '';
  tooltip?: string;
  pending?: boolean;
  unreadyIntegrationId?: string;
}

export type DataSourceOverviewStatus = Omit<DataSourceSetupStatus, 'label'> & {
  label:
    | DataSourceSetupStatus['label']
    | typeof LIFECYCLE.enabled.label
    | typeof LIFECYCLE.disabled.label;
};

/** Matches the Setup column badge "Needs integration setup". */
export function dataSourceNeedsIntegrationSetup(
  ds: DataSourceItem,
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
  secretStatusLoading: boolean,
): boolean {
  return (
    dataSourceIntegrations(ds).length > 0 &&
    !isDataSourceIntegrationReady(
      ds,
      summariesByIntegrationId,
      secretStatusLoading,
    )
  );
}

/** Matches the Setup column badge "Needs setup" (source config, no integration). */
export function dataSourceNeedsSourceSetup(
  ds: DataSourceItem,
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
  secretStatusLoading: boolean,
): boolean {
  if (
    isDataSourceConfigurationReady(
      ds,
      summariesByIntegrationId,
      secretStatusLoading,
    )
  ) {
    return false;
  }

  return !dataSourceNeedsIntegrationSetup(
    ds,
    summariesByIntegrationId,
    secretStatusLoading,
  );
}

/**
 * Setup readiness for the overview Setup column and detail drawer — **Ready** /
 * **Needs setup** / **Needs integration setup** — with the specific reason in the
 * tooltip. Single source of truth so the column, filters, and drawer can't drift.
 */
export function getDataSourceSetupStatus(
  ds: DataSourceItem,
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
  secretStatusLoading: boolean,
): DataSourceSetupStatus {
  const hasIntegration = dataSourceIntegrations(ds).length > 0;
  const integrationReady = isDataSourceIntegrationReady(
    ds,
    summariesByIntegrationId,
    secretStatusLoading,
  );
  const configurationReady = isDataSourceConfigurationReady(
    ds,
    summariesByIntegrationId,
    secretStatusLoading,
  );
  const reason =
    getIntegrationReadinessReason(
      ds,
      summariesByIntegrationId,
      secretStatusLoading,
    ) ??
    getDataSourceReadinessReason(
      ds,
      summariesByIntegrationId,
      secretStatusLoading,
    );
  const secretsPending =
    secretStatusLoading &&
    dataSourceIntegrations(ds).some(integration => integration.id) &&
    reason === undefined;

  if (hasIntegration && !integrationReady) {
    if (secretsPending) {
      return { tone: 'muted', label: '', pending: true };
    }

    const unreadyIntegration = resolveUnreadyIntegration(
      ds,
      summariesByIntegrationId,
      secretStatusLoading,
    );

    return {
      tone: READINESS.needsIntegrationSetup.tone,
      label: READINESS.needsIntegrationSetup.label,
      tooltip: reason ?? READINESS.needsIntegrationSetup.label,
      unreadyIntegrationId: unreadyIntegration?.id,
    };
  }

  if (!configurationReady) {
    if (secretsPending) {
      return { tone: 'muted', label: '', pending: true };
    }

    return {
      tone: READINESS.needsSetup.tone,
      label: READINESS.needsSetup.label,
      tooltip: reason ?? READINESS.needsSetup.label,
    };
  }

  if (secretsPending) {
    return { tone: 'muted', label: '', pending: true };
  }

  if (ds.execution?.isDryRun && ds.execution.status === 'completed') {
    return {
      tone: 'muted',
      label: READINESS.ready.label,
      tooltip: ds.enabled ? 'Validated' : 'Validated — ready to enable',
    };
  }

  return {
    tone: READINESS.ready.tone,
    label: READINESS.ready.label,
    tooltip: READINESS.ready.label,
  };
}

export function getDataSourceOverviewStatus(
  ds: DataSourceItem,
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
  secretStatusLoading: boolean,
): DataSourceOverviewStatus {
  const setup = getDataSourceSetupStatus(
    ds,
    summariesByIntegrationId,
    secretStatusLoading,
  );

  if (setup.pending || setup.label !== READINESS.ready.label) {
    return setup;
  }

  const lifecycle = getDataSourceLifecycleStatus(ds);
  const status = statusValue(LIFECYCLE, lifecycle);

  return {
    ...setup,
    tone: status.tone,
    label: status.label,
    tooltip:
      lifecycle === 'enabled' ? status.label : 'Configured and ready to enable',
  };
}

export type DataSourceLifecycleStatus = LifecycleStatus;

/** Matches the toolbar status dot + label on the data source editor. */
export const DATA_SOURCE_STATUS_INDICATOR_STYLES: Record<
  DataSourceLifecycleStatus,
  { tone: StatusIndicatorTone; text: string }
> = {
  enabled: {
    tone: 'success',
    text: 'text-foreground',
  },
  disabled: {
    tone: 'neutral',
    text: 'text-muted-foreground',
  },
};

export function getDataSourceLifecycleStatus({
  enabled,
}: {
  enabled: boolean;
}): DataSourceLifecycleStatus {
  return enabled ? 'enabled' : 'disabled';
}

export function getDataSourceLifecycleLabel(
  status: DataSourceLifecycleStatus,
): string {
  return statusValue(LIFECYCLE, status).label;
}

/** Safe style lookup for toolbar / table indicators (avoids dynamic record indexing). */
export function getDataSourceStatusIndicatorStyle(
  status: DataSourceLifecycleStatus,
): { tone: StatusIndicatorTone; text: string } {
  switch (status) {
    case 'enabled':
      return DATA_SOURCE_STATUS_INDICATOR_STYLES.enabled;
    case 'disabled':
      return DATA_SOURCE_STATUS_INDICATOR_STYLES.disabled;
  }
}

export function getDataSourceToggleActionLabel(isEnabled: boolean): string {
  return getToggleActionLabel(isEnabled);
}

export function getDataSourceToggleSuccessMessage(
  nextEnabled: boolean,
): string {
  return nextEnabled ? 'Data source enabled' : 'Data source disabled';
}

export function getDataSourceToggleFailureVerb(nextEnabled: boolean): string {
  return getToggleActionVerb(nextEnabled);
}
