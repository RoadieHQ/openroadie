import { useMemo } from 'react';
import { Zap } from 'lucide-react';
import { Badge } from '@roadiehq/ui/badge';
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import { deriveActionMode } from '@roadiehq/actions-common';
import {
  DetailDrawer,
  DetailSection,
  DetailFields,
  PreviewTable,
  formatRelative,
  formatAbsolute,
  type PreviewColumn,
} from '../../common';
import { LIFECYCLE } from '../../overview';
import { actionDetail } from '../../../config/paths';
import { useIntegrations } from '../../integrations/use-integrations';
import type { ActionParam, ActionStep, ActionWithSchema } from '../types';

function resolveMode(action: ActionWithSchema): 'read' | 'write' {
  return action.effectiveMode ?? action.mode ?? deriveActionMode(action.steps);
}

const PARAMETER_COLUMNS: PreviewColumn<ActionParam>[] = [
  {
    key: 'name',
    header: 'Name',
    className: 'align-top',
    cell: param => (
      <span className="block truncate font-mono text-xs" title={param.name}>
        {param.name}
      </span>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    className: 'w-1/3 align-top',
    cell: param => (
      <span className="text-xs text-muted-foreground">{param.type}</span>
    ),
  },
  {
    key: 'required',
    header: 'Required',
    className: 'w-24 align-top',
    cell: param =>
      param.required ? (
        <Badge variant="outline" className="text-[10px]">
          Required
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground">Optional</span>
      ),
  },
];

export interface ActionDetailDrawerProps {
  /** URL-selected id. Kept separate so stale deep links can be identified. */
  actionId: string | null;
  /** The row being previewed, from the list. `undefined` while none selected. */
  action: ActionWithSchema | undefined;
  open: boolean;
  /** True while the actions list is still loading for a deep-linked id. */
  listLoading?: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Detail drawer for an Actions row. Everything shown comes straight off the
 * list row (`ActionWithSchema` already carries steps/parameters/mode/version),
 * so no extra fetch is needed. Integration names for the step preview are
 * resolved on demand — only while the drawer is open.
 */
export function ActionDetailDrawer({
  actionId,
  action,
  open,
  listLoading = false,
  onOpenChange,
}: ActionDetailDrawerProps) {
  // Resolve step integration ids to readable names. Skipped (no fetch) until
  // the drawer opens; the result is cached for subsequent opens.
  const { integrations } = useIntegrations({ skip: !open });
  const integrationNameById = useMemo(
    () =>
      new Map(
        integrations.map(integration => [integration.id, integration.name]),
      ),
    [integrations],
  );

  const mode = action ? resolveMode(action) : undefined;
  const notFound = open && actionId != null && !action && !listLoading;
  const loading = open && listLoading && actionId != null && !action;

  const stepColumns: PreviewColumn<ActionStep>[] = useMemo(
    () => [
      {
        key: 'request',
        header: 'Request',
        className: 'align-top',
        cell: step => (
          <span className="flex min-w-0 items-center gap-1.5">
            <Badge variant="secondary" className="font-mono text-[10px]">
              {step.request.method}
            </Badge>
            <span
              className="min-w-0 truncate font-mono text-xs text-muted-foreground"
              title={step.request.path}
            >
              {step.request.path || '—'}
            </span>
          </span>
        ),
      },
      {
        key: 'integration',
        header: 'Integration',
        className: 'w-1/3 align-top',
        cell: step => {
          const name = integrationNameById.get(step.integrationId);
          return (
            <span
              className="block truncate text-xs text-foreground"
              title={name ?? step.integrationId}
            >
              {name ?? (
                <span className="text-muted-foreground">
                  {step.integrationId || '—'}
                </span>
              )}
            </span>
          );
        },
      },
    ],
    [integrationNameById],
  );

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={action?.name ?? 'Action'}
      subtitle={action?.slug}
      icon={
        <IntegrationIconFrame size="group">
          <Zap className="size-4 shrink-0 text-primary" />
        </IntegrationIconFrame>
      }
      status={
        action ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <Badge variant={action.enabled ? 'success' : 'outlineMuted'}>
              {action.enabled
                ? LIFECYCLE.enabled.label
                : LIFECYCLE.disabled.label}
            </Badge>
            {mode ? (
              <Badge
                variant={mode === 'read' ? 'successOutline' : 'warningSubtle'}
                className="text-[10px] uppercase"
              >
                {mode}
              </Badge>
            ) : null}
          </span>
        ) : undefined
      }
      editAction={
        action
          ? {
              type: 'link',
              href: actionDetail(action.id),
              viewTransition: true,
            }
          : undefined
      }
      loading={loading}
      error={notFound ? 'Action not found.' : undefined}
    >
      {action && (
        <>
          <DetailSection title="Details">
            <DetailFields
              fields={[
                {
                  label: 'Mode',
                  value: <span className="capitalize">{mode}</span>,
                },
                { label: 'Version', value: action.currentVersion },
                {
                  label: 'Created',
                  value: (
                    <span title={formatAbsolute(action.createdAt)}>
                      {formatRelative(action.createdAt)}
                    </span>
                  ),
                },
                {
                  label: 'Updated',
                  value: (
                    <span title={formatAbsolute(action.updatedAt)}>
                      {formatRelative(action.updatedAt)}
                    </span>
                  ),
                },
              ]}
            />
          </DetailSection>

          {action.description && (
            <DetailSection title="Description">
              <p className="text-sm text-surface-foreground">
                {action.description}
              </p>
            </DetailSection>
          )}

          <DetailSection title="Parameters" count={action.parameters.length}>
            <PreviewTable
              columns={PARAMETER_COLUMNS}
              rows={action.parameters}
              getRowId={param => param.name}
              skeletonRows={2}
              emptyMessage="No parameters."
            />
          </DetailSection>

          <DetailSection title="Steps" count={action.steps.length}>
            <PreviewTable
              columns={stepColumns}
              rows={action.steps}
              getRowId={step => step.id}
              skeletonRows={2}
              emptyMessage="No steps."
            />
          </DetailSection>
        </>
      )}
    </DetailDrawer>
  );
}
