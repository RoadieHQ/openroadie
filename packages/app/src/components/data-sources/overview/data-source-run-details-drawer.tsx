import { Database } from 'lucide-react';
import { IntegrationIconFrame, IntegrationLogo } from '@roadiehq/ui/item-list';
import { DetailDrawer, formatAbsolute } from '../../common';
import { StatusCell } from '../../common/execution-status';
import { dataSourceDetail } from '../../../config/paths';
import type { DataSourceItem } from '../types';
import { ExecutionSubscription, useExecution } from '../use-execution';
import { ExecutionMonitor } from '../data-source-editor/execution-monitor';

export interface DataSourceRunDetailsDrawerProps {
  dataSourceId: string | null;
  dataSource: DataSourceItem | undefined;
  open: boolean;
  listLoading?: boolean;
  running: boolean;
  onRun: (id: string) => void;
  onOpenChange: (open: boolean) => void;
}

export function DataSourceRunDetailsDrawer({
  dataSourceId,
  dataSource,
  open,
  listLoading = false,
  running,
  onRun,
  onOpenChange,
}: DataSourceRunDetailsDrawerProps) {
  const execution = dataSource?.execution?.isDryRun
    ? undefined
    : dataSource?.execution;
  const executionId = execution?.executionId;
  const selectedDataSourceId = dataSource?.id;
  const details = useExecution(open ? executionId : undefined);
  const notFound = open && dataSourceId != null && !dataSource && !listLoading;
  const noRuns = open && dataSource != null && !executionId;
  const lastRun = formatAbsolute(execution?.lastRunAt);

  return (
    <DetailDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Run details"
      subtitle={
        dataSource
          ? [dataSource.name, lastRun].filter(Boolean).join(' · ')
          : undefined
      }
      icon={
        <IntegrationIconFrame size="group">
          {dataSource?.logoUrl ? (
            <IntegrationLogo src={dataSource.logoUrl} size={16} />
          ) : (
            <Database className="size-4 shrink-0 text-muted-foreground" />
          )}
        </IntegrationIconFrame>
      }
      status={
        executionId ? (
          <StatusCell
            status={details.execution?.status ?? execution?.status ?? 'pending'}
          />
        ) : undefined
      }
      editAction={
        dataSource
          ? { type: 'link', href: dataSourceDetail(dataSource.id) }
          : undefined
      }
      editLabel="Open data source"
      loading={open && listLoading && !dataSource}
      error={
        notFound
          ? 'Data source not found.'
          : noRuns
            ? 'This data source has not run yet.'
            : undefined
      }
      size="xl"
    >
      {executionId && (
        <>
          <ExecutionSubscription executionId={executionId} />
          <div className="flex min-h-[32rem] flex-col overflow-hidden">
            <ExecutionMonitor
              execution={details.execution}
              nodeExecutions={details.nodeExecutions}
              logs={details.logs}
              requestLogs={details.requestLogs}
              loading={details.loading}
              error={details.error}
              isFailed={details.isFailed}
              retry={details.retry}
              onRetry={
                selectedDataSourceId
                  ? () => onRun(selectedDataSourceId)
                  : undefined
              }
              retrying={running}
            />
          </div>
        </>
      )}
    </DetailDrawer>
  );
}
