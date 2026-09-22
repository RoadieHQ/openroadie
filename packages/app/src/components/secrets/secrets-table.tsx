import { useCallback, useContext, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { CircleCheck, CircleMinus, ExternalLink } from 'lucide-react';
import { useSecrets } from '../../api';
import { queryKeys, secretKeysQuery } from '../../api/queries';
import { SecretStatusType } from '../../api/secrets';
import type { Secret } from '../../api/secrets';
import { Badge } from '@roadiehq/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { EditSecretButton } from './edit-secret-button';
import { SecretSettingsContext } from './secret-settings-context';
import { AddSecretButton } from './add-secret-button';
import {
  OverviewListingPageHeader,
  OverviewListingToolbar,
  OverviewListingStandaloneBody,
} from '../common';
import {
  OverviewTable,
  relativeDateColumnFilter,
  SECRET,
  statusColumnFilter,
  useOverviewState,
  type ColumnConfig,
  type OverviewConfig,
  type StatusDef,
} from '../overview';
import { SECRETS_COLUMN_WIDTH } from './secrets-table-layout';
import {
  getWorkspaceScopeKey,
  workspaceQueryKeyInScope,
} from '../../api/workspace-scope';

function formatRelativeTimestamp(value?: string): string {
  if (!value) {
    return '—';
  }

  return (
    DateTime.fromJSDate(new Date(value)).toRelative({
      unit: ['days', 'hours', 'minutes', 'seconds'],
    }) ?? '—'
  );
}

function compareOptionalTimestamps(a?: string, b?: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return new Date(a).getTime() - new Date(b).getTime();
}

const StatusBadge = ({ status }: { status?: string }) => {
  switch (status) {
    case SecretStatusType.Available:
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="success"
                icon={<CircleCheck />}
                className="cursor-default gap-1"
              >
                {SECRET.configured.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Secret is set and active</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case SecretStatusType.Not_Set:
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                icon={<CircleMinus />}
                className="cursor-default gap-1 text-muted-foreground"
              >
                {SECRET.notSet.label}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>No value has been configured</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    default:
      return null;
  }
};

const SECRET_STATUS_FILTERS = [
  {
    value: 'available',
    label: SECRET.configured.label,
    icon: CircleCheck,
    predicate: (secret: Secret) => secret.status === SecretStatusType.Available,
  },
  {
    value: 'not-set',
    label: SECRET.notSet.label,
    icon: CircleMinus,
    predicate: (secret: Secret) => secret.status === SecretStatusType.Not_Set,
  },
] satisfies StatusDef<Secret>[];

const SECRET_OVERVIEW_CONFIG: OverviewConfig<Secret> = {
  getId: secret => secret.name,
  searchFields: secret => [secret.name, secret.description, secret.status],
  statuses: SECRET_STATUS_FILTERS,
};

export function SecretsTable() {
  const [editingSecret, setEditingSecret] = useState('');
  const secretsClient = useSecrets();
  const queryClient = useQueryClient();
  const workspaceScopeKey = getWorkspaceScopeKey();
  const { readOnly } = useContext(SecretSettingsContext);

  const { data, isLoading, error } = useQuery(secretKeysQuery(secretsClient));

  const secrets = useMemo(
    () => [...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );

  const {
    search,
    rows: filteredSecrets,
    setSearch,
  } = useOverviewState(secrets, SECRET_OVERVIEW_CONFIG);

  const refreshData = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: workspaceQueryKeyInScope(
        queryKeys.secretKeys,
        workspaceScopeKey,
      ),
    });
  }, [queryClient, workspaceScopeKey]);

  const columns = useMemo<ColumnConfig<Secret>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        enableHiding: false,
        sortable: true,
        accessor: s => s.name,
        width: SECRETS_COLUMN_WIDTH.name,
        headClassName: 'pl-3 sm:pl-4',
        cellClassName: 'overflow-hidden pl-3 sm:pl-4',
        cell: s => (
          <span
            className="block w-full min-w-0 truncate font-mono text-sm text-foreground"
            title={s.name}
          >
            {s.name}
          </span>
        ),
      },
      {
        id: 'description',
        header: 'Description',
        enableHiding: true,
        sortable: true,
        accessor: s => s.description ?? '',
        width: SECRETS_COLUMN_WIDTH.description,
        cell: s => (
          <span className="text-sm text-muted-foreground">
            {s.description || '—'}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        enableHiding: true,
        sortable: true,
        accessor: s => s.status ?? '',
        filter: statusColumnFilter(SECRET_STATUS_FILTERS),
        width: SECRETS_COLUMN_WIDTH.status,
        cell: s => <StatusBadge status={s.status} />,
      },
      {
        id: 'createdAt',
        header: 'Created At',
        enableHiding: true,
        sortable: true,
        accessor: s => s.createdAt ?? '',
        filter: relativeDateColumnFilter('Created At', s => s.createdAt),
        sortingFn: (a, b) =>
          compareOptionalTimestamps(a.createdAt, b.createdAt),
        width: SECRETS_COLUMN_WIDTH.createdAt,
        cell: s => (
          <span className="text-sm whitespace-nowrap text-muted-foreground">
            {formatRelativeTimestamp(s.createdAt)}
          </span>
        ),
      },
      {
        id: 'lastModified',
        header: 'Last Modified',
        enableHiding: true,
        sortable: true,
        accessor: s => s.lastModified ?? '',
        filter: relativeDateColumnFilter('Last Modified', s => s.lastModified),
        sortingFn: (a, b) =>
          compareOptionalTimestamps(a.lastModified, b.lastModified),
        width: SECRETS_COLUMN_WIDTH.lastModified,
        cell: s => (
          <span className="text-sm whitespace-nowrap text-muted-foreground">
            {formatRelativeTimestamp(s.lastModified)}
          </span>
        ),
      },
      {
        id: 'helpUrl',
        header: 'Help',
        enableHiding: true,
        sortable: true,
        accessor: s => s.helpUrl ?? '',
        filter: {
          kind: 'boolean',
          label: 'Help',
          value: s => Boolean(s.helpUrl),
          trueLabel: 'Docs available',
          falseLabel: 'No docs',
        },
        width: SECRETS_COLUMN_WIDTH.helpUrl,
        cell: s =>
          s.helpUrl ? (
            <a
              href={s.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
            >
              Docs
              <ExternalLink className="size-3" />
            </a>
          ) : null,
      },
    ],
    [],
  );

  const renderRowActions = useCallback(
    (secret: Secret) => (
      <EditSecretButton
        secret={secret}
        refreshData={refreshData}
        open={editingSecret === secret.name}
        handleClickOpen={() => setEditingSecret(secret.name)}
        handleClose={() => setEditingSecret('')}
      />
    ),
    [refreshData, editingSecret],
  );

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <OverviewListingStandaloneBody className="flex min-h-0 flex-1 flex-col space-y-4 sm:space-y-6">
        <div className="shrink-0">
          <OverviewListingPageHeader
            title="Secrets"
            description={
              readOnly
                ? 'Secrets are managed externally via environment variables.'
                : 'Manage secret keys used to integrate with third-party services'
            }
            toolbar={
              !error && secrets.length > 0 ? (
                <OverviewListingToolbar
                  searchValue={search}
                  onSearchChange={setSearch}
                  searchPlaceholder="Search by name, description, or status..."
                  searchAriaLabel="Search secrets"
                  variant="pageHeader"
                />
              ) : null
            }
            primaryAction={
              !readOnly ? (
                <AddSecretButton refreshData={refreshData} />
              ) : undefined
            }
          />
        </div>

        {error ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-lg font-medium text-foreground">
              Unable to display secrets
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {error.message}
            </p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <OverviewTable<Secret>
              data={filteredSecrets}
              columns={columns}
              columnDisplay={{ tableId: 'secrets' }}
              getRowId={s => s.name}
              loading={isLoading}
              paginate={false}
              skeletonRowCount={5}
              rowActions={readOnly ? undefined : renderRowActions}
              emptyState={
                secrets.length === 0
                  ? 'No secrets configured'
                  : 'No secrets match your filters'
              }
            />
          </div>
        )}
      </OverviewListingStandaloneBody>
    </div>
  );
}
