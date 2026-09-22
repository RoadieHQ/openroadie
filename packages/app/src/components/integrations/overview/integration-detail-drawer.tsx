import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Blocks, ExternalLink, Power } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@roadiehq/ui/alert';
import { Button } from '@roadiehq/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { IntegrationLogo, IntegrationIconFrame } from '@roadiehq/ui/item-list';
import {
  DetailDrawer,
  DetailSection,
  DetailFields,
  PreviewTable,
  formatRelative,
  formatAbsolute,
  type PreviewColumn,
} from '../../common';
import { OverviewStatusCell, READINESS } from '../../overview';
import { dataSourceDetail, integrationDetail } from '../../../config/paths';
import { useWorkflows, useAlert } from '../../../api';
import { useOptimisticMutation } from '../../../api/query-hooks';
import { invalidationKeys, queryKeys } from '../../../api/queries';
import {
  getDataSourceToggleActionLabel,
  getDataSourceToggleFailureVerb,
  getDataSourceToggleSuccessMessage,
} from '../../data-sources/data-source-status';
import type { IntegrationItem, WorkflowRef } from '../types';
import { INTEGRATION_TYPE_META } from '../types';
import {
  useIntegrationSecretStatus,
  useInvalidateIntegrationSecretStatus,
} from '../use-integration-secret-status';
import { getIntegrationRequiredSecretRefs } from '../secret-requirements';
import { RequiredSecretsPanel } from '../form/required-secrets-panel';
import {
  getIntegrationSetupReason,
  IntegrationReadinessStatus,
  IntegrationSourceBadge,
} from './integration-status-badges';

/** `bearer-token` → "Bearer token", `none` → "None". */
function humanizeAuthType(authType: string): string {
  const words = authType.replace(/[_-]+/g, ' ').trim();
  if (!words) return '—';
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function backendTypeLabel(backendType: IntegrationItem['backendType']): string {
  return backendType === 'aws' ? 'AWS' : 'HTTP';
}

/** Compact rate-limit summary, or `null` when no limits are configured. */
function formatRateLimits(integration: IntegrationItem): string | null {
  const parts: string[] = [];
  if (integration.requestsPerSecond != null) {
    parts.push(`${integration.requestsPerSecond.toLocaleString()}/s`);
  }
  if (integration.requestsPerHour != null) {
    parts.push(`${integration.requestsPerHour.toLocaleString()}/h`);
  }
  if (integration.burstCapacity != null) {
    parts.push(`burst ${integration.burstCapacity.toLocaleString()}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function getTypeMeta(type: string) {
  if (Object.hasOwn(INTEGRATION_TYPE_META, type)) {
    return INTEGRATION_TYPE_META[type as keyof typeof INTEGRATION_TYPE_META];
  }
  return INTEGRATION_TYPE_META.other;
}

/** Builds the "Used by" columns; the actions column needs the toggle handler
 * and in-flight state from the drawer, so this can't be a module constant. */
function buildReferencingWorkflowColumns(
  togglingIds: Set<string>,
  onToggleEnabled: (id: string, enabled: boolean) => void,
): PreviewColumn<WorkflowRef>[] {
  return [
    {
      key: 'name',
      header: 'Data source',
      className: 'align-top',
      cell: workflow => (
        <Link
          to={dataSourceDetail(workflow.id)}
          className="motion-colors inline-flex min-w-0 items-center gap-1 text-foreground hover:underline"
        >
          <span className="truncate">{workflow.name}</span>
          <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-24 align-top',
      cell: workflow =>
        workflow.enabled == null ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <OverviewStatusCell
            expanded
            tone={workflow.enabled ? 'success' : 'muted'}
            label={workflow.enabled ? 'Enabled' : 'Disabled'}
          />
        ),
    },
    {
      key: 'steps',
      header: 'Steps',
      className: 'w-12 align-middle tabular-nums',
      cell: workflow => workflow.nodeCount ?? '—',
    },
    {
      key: 'toggle',
      header: 'Action',
      className: 'w-24 whitespace-nowrap py-1 align-middle text-right',
      cell: workflow =>
        workflow.enabled == null ? null : (
          <div className="flex justify-end">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    disabled={togglingIds.has(workflow.id)}
                    aria-label={getDataSourceToggleActionLabel(
                      workflow.enabled,
                    )}
                    onClick={() =>
                      onToggleEnabled(workflow.id, !workflow.enabled)
                    }
                  >
                    <Power className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {getDataSourceToggleActionLabel(workflow.enabled)}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ),
    },
  ];
}

export interface IntegrationDetailDrawerProps {
  /** URL-selected id. Kept separate so the drawer opens even before a row match. */
  integrationId: string | null;
  /** The row being previewed, from the list. `undefined` while none selected. */
  integration: IntegrationItem | undefined;
  open: boolean;
  /** True while the integrations list is still loading for a deep-linked id. */
  listLoading?: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Detail drawer for an Integrations row. Every field comes straight from the
 * rich list item; secret readiness is fetched on demand (only while open) via
 * {@link useIntegrationSecretStatus}.
 */
export function IntegrationDetailDrawer({
  integrationId,
  integration,
  open,
  listLoading = false,
  onOpenChange,
}: IntegrationDetailDrawerProps) {
  const api = useWorkflows();
  const alertApi = useAlert();
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());
  const toggleMutation = useOptimisticMutation<
    Awaited<ReturnType<typeof api.workflows.update>>,
    { id: string; enabled: boolean },
    Awaited<ReturnType<typeof api.workflows.list>>
  >({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.workflows.update(id, { enabled }),
    cacheKey: queryKeys.dataIngestionWorkflows,
    update: (current, { id, enabled }) => ({
      ...current,
      data: current.data.map(workflow =>
        workflow.id === id ? { ...workflow, enabled } : workflow,
      ),
    }),
    invalidates: (_workflow, { id }) => invalidationKeys.workflowSaved(id),
  });
  const handleToggleEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      setTogglingIds(prev => new Set(prev).add(id));
      try {
        await toggleMutation.mutateAsync({ id, enabled });
        alertApi.post({
          message: getDataSourceToggleSuccessMessage(enabled),
          severity: 'success',
          display: 'transient',
        });
      } catch (error) {
        alertApi.post({
          message: `Failed to ${getDataSourceToggleFailureVerb(enabled)}: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
          severity: 'error',
        });
      } finally {
        setTogglingIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [toggleMutation, alertApi],
  );
  const referencingWorkflowColumns = useMemo(
    () => buildReferencingWorkflowColumns(togglingIds, handleToggleEnabled),
    [togglingIds, handleToggleEnabled],
  );

  // Resolve secret readiness for just this integration, and only while open.
  const { summariesByIntegrationId, loading: secretStatusLoading } =
    useIntegrationSecretStatus(open && integration ? [integration] : []);
  const summary = integration
    ? summariesByIntegrationId.get(integration.id)
    : undefined;

  // A deep-linked id with no matching row while the list is still loading shows
  // the skeleton; only flag "not found" once the list has actually settled.
  const notFound =
    open && integrationId != null && !integration && !listLoading;
  const loading = open && listLoading && integrationId != null && !integration;

  const subtitle = integration
    ? getTypeMeta(integration.type).label
    : undefined;
  const rateLimits = integration ? formatRateLimits(integration) : null;
  const githubApps = integration?.extensions?.githubApps ?? [];

  // Whether this integration references any secrets at all — computed
  // synchronously from its config so the section (and its skeleton) render
  // immediately instead of popping in once readiness resolves.
  const secretRefs = integration
    ? getIntegrationRequiredSecretRefs(integration)
    : [];
  const hasSecretRefs = secretRefs.length > 0;

  // Setting a secret inline invalidates the shared secret + readiness caches so
  // the drawer's status banner and the overview list both refresh.
  const invalidateSecretStatus = useInvalidateIntegrationSecretStatus();

  // The actionable "needs setup" reason (missing secrets / config) is surfaced
  // as a warning banner at the top rather than a stat tile.
  const setupReason =
    integration && !secretStatusLoading
      ? getIntegrationSetupReason(integration, summary)
      : undefined;

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={integration?.name ?? 'Integration'}
      subtitle={subtitle}
      icon={
        <IntegrationIconFrame size="group">
          {integration?.logoUrl ? (
            <IntegrationLogo src={integration.logoUrl} size={16} />
          ) : (
            <Blocks className="size-4 shrink-0 text-muted-foreground" />
          )}
        </IntegrationIconFrame>
      }
      editAction={
        integration
          ? { type: 'link', href: integrationDetail(integration.id) }
          : undefined
      }
      loading={loading}
      error={notFound ? 'Integration not found.' : undefined}
    >
      {integration && (
        <>
          {setupReason && (
            <Alert
              variant="default"
              className="border-warning/40 bg-warning/10"
            >
              <AlertTriangle className="size-4 text-warning" />
              <AlertTitle>{READINESS.needsSetup.label}</AlertTitle>
              <AlertDescription>{setupReason}</AlertDescription>
            </Alert>
          )}

          <DetailSection title="Details">
            <DetailFields
              fields={[
                {
                  label: 'Status',
                  value: (
                    <IntegrationReadinessStatus
                      item={integration}
                      secretSummary={summary}
                      loading={secretStatusLoading}
                      expanded
                    />
                  ),
                },
                {
                  label: 'Source',
                  value: <IntegrationSourceBadge item={integration} />,
                },
                { label: 'Host', value: integration.host },
                {
                  label: 'Auth type',
                  value: humanizeAuthType(integration.authType),
                },
                {
                  label: 'Backend type',
                  value: backendTypeLabel(integration.backendType),
                },
                { label: 'Rate limits', value: rateLimits },
                {
                  label: 'Created by',
                  value:
                    integration.createdBy === 'system'
                      ? 'System'
                      : integration.createdBy,
                },
                {
                  label: 'Created',
                  value: (
                    <span title={formatAbsolute(integration.createdAt)}>
                      {formatRelative(integration.createdAt)}
                    </span>
                  ),
                },
                {
                  label: 'Updated',
                  value: (
                    <span title={formatAbsolute(integration.updatedAt)}>
                      {formatRelative(integration.updatedAt)}
                    </span>
                  ),
                },
              ]}
            />
          </DetailSection>

          {integration.description && (
            <DetailSection title="Description">
              <p className="text-sm text-surface-foreground">
                {integration.description}
              </p>
            </DetailSection>
          )}

          {hasSecretRefs && (
            <RequiredSecretsPanel
              secretRefs={secretRefs}
              onSecretsChanged={() => void invalidateSecretStatus()}
            />
          )}

          {integration.referencingWorkflows.length > 0 && (
            <DetailSection
              title="Used by"
              count={integration.referencingWorkflows.length}
            >
              <PreviewTable
                columns={referencingWorkflowColumns}
                rows={integration.referencingWorkflows}
                getRowId={workflow => workflow.id}
                rowHref={workflow => dataSourceDetail(workflow.id)}
                emptyMessage="No data sources use this integration yet."
              />
            </DetailSection>
          )}

          {githubApps.length > 0 && (
            <DetailSection title="GitHub apps">
              <div className="flex flex-col gap-1.5">
                {githubApps.map(app => (
                  <div
                    key={`${app.appId}::${app.host}`}
                    className="flex min-w-0 items-center gap-1.5 text-sm"
                  >
                    <span className="truncate font-medium text-surface-foreground">
                      {app.slug ?? app.appId}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {app.host}
                    </span>
                  </div>
                ))}
              </div>
            </DetailSection>
          )}
        </>
      )}
    </DetailDrawer>
  );
}
