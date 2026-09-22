import { READINESS_REASON, missingSecretsReason } from '../overview';
import {
  getAwsOrganizationsConfig,
  hasAwsProfiles,
} from '../integrations/aws-config';
import { isSecretsReadyForList } from '../integrations/secret-readiness';
import type { IntegrationSecretSummary } from '../integrations/use-integration-secret-status';
import { hasDynamicAwsAccountSelection } from './aws-source-configured';
import type { DataSourceItem, IntegrationInfo } from './types';

type ReadinessIntegration = {
  id?: string;
  backendType?: 'http' | 'aws';
  config?: Record<string, unknown>;
  readyForCurrentScope?: boolean;
};

type ReadinessTarget = {
  integrationId?: string;
  integration?: ReadinessIntegration;
  integrations?: ReadinessIntegration[];
  isSourceConfigured?: boolean;
  sourceConfig?: Record<string, unknown>;
};

const AWS_ACCOUNTS_REQUIRED_REASON =
  'Add at least one AWS account or enable Organizations';

/**
 * The integrations an item involves (primary + chained), tolerant of the
 * pre-`integrations` shape where only the primary `integration` was present.
 */
function pickIntegrations<I>(item: {
  integration?: I;
  integrations?: I[];
}): I[] {
  if (item.integrations && item.integrations.length > 0) {
    return item.integrations;
  }
  return item.integration ? [item.integration] : [];
}

/** The full integration records a data source involves (primary + chained). */
export function dataSourceIntegrations(ds: DataSourceItem): IntegrationInfo[] {
  return pickIntegrations(ds);
}

function involvedIntegrations(item: ReadinessTarget): ReadinessIntegration[] {
  return pickIntegrations(item);
}

function integrationSecretSummary(
  integration: ReadinessIntegration,
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
): IntegrationSecretSummary | undefined {
  return integration.id
    ? summariesByIntegrationId.get(integration.id)
    : undefined;
}

function integrationReadinessReason(
  integration: ReadinessIntegration,
  summary: IntegrationSecretSummary | undefined,
  secretStatusLoading: boolean,
  configuredIntegrationId?: string,
): string | undefined {
  if (!integration.id) {
    if (configuredIntegrationId) {
      return READINESS_REASON.integrationUnavailable;
    }
    return READINESS_REASON.noIntegration;
  }

  if (isSecretsReadyForList(integration, summary, secretStatusLoading)) {
    return undefined;
  }

  if (secretStatusLoading) {
    return undefined;
  }

  if (summary && !summary.hasRequiredConfig) {
    return READINESS_REASON.configRequired;
  }

  const missingSecretCount = summary?.missingSecretRefs.length ?? 0;
  if (missingSecretCount > 0) {
    return missingSecretsReason(missingSecretCount);
  }

  return READINESS_REASON.setupRequired;
}

function sourceIntegrationReadinessReason(
  item: ReadinessTarget,
): string | undefined {
  if (
    item.integration?.backendType !== 'aws' ||
    !item.sourceConfig ||
    !hasDynamicAwsAccountSelection(item.sourceConfig)
  ) {
    return undefined;
  }

  if (getAwsOrganizationsConfig(item.integration.config)?.enabled) {
    return undefined;
  }

  if (hasAwsProfiles(item.integration.config)) {
    return undefined;
  }

  return AWS_ACCOUNTS_REQUIRED_REASON;
}

export function resolveUnreadyIntegration(
  item: ReadinessTarget,
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
  secretStatusLoading = false,
): ReadinessIntegration | undefined {
  for (const integration of involvedIntegrations(item)) {
    if (!integration.id) continue;
    const summary = integrationSecretSummary(
      integration,
      summariesByIntegrationId,
    );
    if (!isSecretsReadyForList(integration, summary, secretStatusLoading)) {
      return integration;
    }
  }
  if (sourceIntegrationReadinessReason(item)) {
    return item.integration;
  }
  return undefined;
}

export function resolveIntegrationSecretSummary(
  item: ReadinessTarget,
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
): IntegrationSecretSummary | undefined {
  const unready = resolveUnreadyIntegration(
    item,
    summariesByIntegrationId,
    false,
  );
  if (unready?.id) {
    return summariesByIntegrationId.get(unready.id);
  }

  return item.integration?.id
    ? summariesByIntegrationId.get(item.integration.id)
    : undefined;
}

export function isDataSourceIntegrationReady(
  item: ReadinessTarget,
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
  secretStatusLoading = false,
): boolean {
  const integrations = involvedIntegrations(item);
  if (integrations.length === 0) {
    return false;
  }

  // Entries without an `id` aren't integrations — they describe an
  // integration-less source (e.g. `source-datastore`, which reads another
  // data source's stored objects) and have nothing to configure. They only
  // count as unready when the source has an `integrationId` configured but
  // the record couldn't be resolved (deleted / out of scope).
  return (
    integrations.every(integration =>
      integration.id
        ? isSecretsReadyForList(
            integration,
            integrationSecretSummary(integration, summariesByIntegrationId),
            secretStatusLoading,
          )
        : !item.integrationId,
    ) && !sourceIntegrationReadinessReason(item)
  );
}

export function isDataSourceConfigurationReady(
  item: ReadinessTarget,
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
  secretStatusLoading = false,
): boolean {
  if (involvedIntegrations(item).length === 0) {
    return false;
  }

  if (
    !isDataSourceIntegrationReady(
      item,
      summariesByIntegrationId,
      secretStatusLoading,
    )
  ) {
    return false;
  }

  if (item.isSourceConfigured === false) {
    return false;
  }

  return true;
}

export function resolveDataSourceReadinessReason(
  item: ReadinessTarget,
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
  secretStatusLoading = false,
): string | undefined {
  return getDataSourceReadinessReason(
    item,
    summariesByIntegrationId,
    secretStatusLoading,
  );
}

/**
 * Returns a human-readable reason why a data source is not ready,
 * or `undefined` when everything looks good (or secrets are still loading).
 */
export function getDataSourceReadinessReason(
  item: ReadinessTarget,
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
  secretStatusLoading = false,
): string | undefined {
  const integrations = involvedIntegrations(item);

  if (integrations.length === 0) {
    if (item.integrationId && !item.integration?.id) {
      return READINESS_REASON.integrationUnavailable;
    }
    return READINESS_REASON.noIntegration;
  }

  for (const integration of integrations) {
    if (!integration.id) {
      // No reason to report for an integration-less source; a configured but
      // unresolvable integration still surfaces below.
      if (!item.integrationId) continue;
      return integrationReadinessReason(
        integration,
        undefined,
        secretStatusLoading,
        item.integrationId,
      );
    }

    const summary = integrationSecretSummary(
      integration,
      summariesByIntegrationId,
    );
    if (!isSecretsReadyForList(integration, summary, secretStatusLoading)) {
      if (secretStatusLoading) {
        if (item.isSourceConfigured === false) {
          return READINESS_REASON.sourceEndpointNotConfigured;
        }
        return undefined;
      }
      return integrationReadinessReason(
        integration,
        summary,
        secretStatusLoading,
        item.integrationId,
      );
    }
  }

  const sourceIntegrationReason = sourceIntegrationReadinessReason(item);
  if (sourceIntegrationReason) {
    return sourceIntegrationReason;
  }

  if (item.isSourceConfigured === false) {
    return READINESS_REASON.sourceEndpointNotConfigured;
  }

  return undefined;
}

/**
 * Returns why an involved integration cannot currently serve this source.
 * `undefined` when the integrations are healthy or secrets are still loading.
 */
export interface DataSourceActionAvailabilityInput {
  /** Whether the data source is currently enabled. */
  enabled: boolean;
  /**
   * Human-readable reason the source is not fully configured, or a falsy value
   * when it is ready. Produced by {@link getDataSourceReadinessReason} /
   * {@link resolveDataSourceReadinessReason}.
   */
  readinessReason?: string | null;
  /** A manual run is already in flight. */
  isRunning?: boolean;
  /** An enable/disable toggle is already in flight. */
  isToggling?: boolean;
}

export interface DataSourceActionAvailability {
  /** The source may be manually run once. */
  canRun: boolean;
  /** A disabled source may be enabled. */
  canEnable: boolean;
  /** The enable/disable menu item should be interactive. */
  canToggle: boolean;
  /**
   * Tooltip for the "Run once" item: an informational hint when clickable,
   * otherwise the reason it's disabled.
   */
  runTooltip: string;
  /**
   * Tooltip for the enable/disable item: an informational hint when clickable,
   * otherwise the reason it's disabled.
   */
  toggleTooltip: string;
}

/**
 * Single source of truth for whether a data source's "Run once" and
 * "Enable"/"Disable" actions are available, plus the tooltip to surface for each.
 *
 * Both running and enabling depend only on the source being fully configured
 * (a falsy `readinessReason`) and not already in flight — never on whether the
 * source is enabled or has unsaved editor changes, since both actions operate on
 * the last saved version. Disabling an already-enabled source is always allowed.
 * (Callers gate on save state separately: the editor only renders these actions
 * for a persisted source.)
 *
 * When an action is clickable its tooltip is an informational hint; otherwise it
 * explains why the action is disabled.
 */
export function getDataSourceActionAvailability({
  enabled,
  readinessReason,
  isRunning = false,
  isToggling = false,
}: DataSourceActionAvailabilityInput): DataSourceActionAvailability {
  const ready = !readinessReason;
  const reason = readinessReason || undefined;
  const canEnable = ready && !isToggling;
  const canRun = ready && !isRunning;
  // Disabling never requires readiness; enabling does.
  const canToggle = enabled ? !isToggling : canEnable;

  let runTooltip: string;
  if (canRun) {
    runTooltip = 'Runs the last saved version';
  } else if (reason) {
    runTooltip = reason;
  } else {
    runTooltip = 'A run is already in progress';
  }

  let toggleTooltip: string;
  if (canToggle) {
    toggleTooltip = enabled
      ? 'Stops the schedule'
      : 'Enables scheduled runs of the last saved version';
  } else if (!enabled && reason) {
    toggleTooltip = reason;
  } else {
    toggleTooltip = 'An update is already in progress';
  }

  return {
    canRun,
    canEnable,
    canToggle,
    runTooltip,
    toggleTooltip,
  };
}

export function getIntegrationReadinessReason(
  item: ReadinessTarget,
  summariesByIntegrationId: Map<string, IntegrationSecretSummary>,
  secretStatusLoading = false,
): string | undefined {
  const integrations = involvedIntegrations(item);

  if (integrations.length === 0) {
    if (item.integrationId && !item.integration?.id) {
      return READINESS_REASON.integrationUnavailable;
    }
    return undefined;
  }

  for (const integration of integrations) {
    if (!integration.id && !item.integrationId) continue;
    const reason = integrationReadinessReason(
      integration,
      integrationSecretSummary(integration, summariesByIntegrationId),
      secretStatusLoading,
      item.integrationId,
    );
    if (reason) {
      return reason;
    }
  }

  return sourceIntegrationReadinessReason(item);
}
