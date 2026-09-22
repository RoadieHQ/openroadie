import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { Badge } from '@roadiehq/ui/badge';
import { Skeleton } from '@roadiehq/ui/skeleton';
import {
  OverviewStatusCell,
  READINESS,
  READINESS_REASON,
  missingSecretsReason,
} from '../../overview';
import type { IntegrationItem } from '../types';
import type { IntegrationSecretSummary } from '../use-integration-secret-status';

const SOURCE_BADGE_CLASSNAME = 'max-w-full min-w-0 whitespace-nowrap';

function IntegrationSourceBadgeLabel({ label }: { label: string }) {
  return (
    <span className="min-w-0 truncate" title={label}>
      {label}
    </span>
  );
}

export function IntegrationSourceBadge({
  item,
  deleteDisabledReason,
}: {
  item: IntegrationItem;
  deleteDisabledReason?: string | null;
}) {
  const sourceLabel = item.createdBy === 'system' ? 'Pre-built' : 'Custom';

  const badge = (
    <Badge variant="outline" className={SOURCE_BADGE_CLASSNAME}>
      <IntegrationSourceBadgeLabel label={sourceLabel} />
    </Badge>
  );

  if (!deleteDisabledReason) {
    return badge;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>{deleteDisabledReason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Why an integration isn't ready, or `undefined` when it is. Shared by the
 * status cell (tooltip) and the drawer's setup banner so they can't drift.
 */
export function getIntegrationSetupReason(
  item: IntegrationItem,
  secretSummary?: IntegrationSecretSummary,
): string | undefined {
  if (secretSummary && !secretSummary.hasRequiredConfig) {
    return READINESS_REASON.configRequired;
  }
  if (secretSummary?.missingSecretRefs.length) {
    return missingSecretsReason(secretSummary.missingSecretRefs.length);
  }
  if (item.readyForCurrentScope === false) {
    return READINESS_REASON.setupRequired;
  }
  return undefined;
}

export function IntegrationReadinessStatus({
  item,
  secretSummary,
  loading,
  expanded,
}: {
  item: IntegrationItem;
  secretSummary?: IntegrationSecretSummary;
  loading?: boolean;
  /** Show the label inline (drawer variant); overviews render dot-only. */
  expanded?: boolean;
}) {
  if (loading) {
    return (
      <Skeleton
        data-testid="integration-status-loading-skeleton"
        aria-hidden="true"
        className="h-4 w-16 rounded sm:h-5"
      />
    );
  }

  // Unified taxonomy: the state is either "Ready" or "Needs setup"; the specific
  // reason lives in the tooltip so integrations and data sources read the same.
  const reason = getIntegrationSetupReason(item, secretSummary);

  if (reason) {
    return (
      <OverviewStatusCell
        tone={READINESS.needsSetup.tone}
        label={READINESS.needsSetup.label}
        tooltip={reason}
        expanded={expanded}
      />
    );
  }

  return (
    <OverviewStatusCell
      tone={READINESS.ready.tone}
      label={READINESS.ready.label}
      tooltip={READINESS.ready.label}
      expanded={expanded}
    />
  );
}
