import type { ReactNode } from 'react';
import { Blocks, CirclePlay, Database } from 'lucide-react';
import { Card } from '@roadiehq/ui/card';
import { Skeleton } from '@roadiehq/ui/skeleton';
import type { DataSourcesSummary } from '../use-data-sources-summary';

function MetricCard(props: {
  label: string;
  icon: ReactNode;
  value: ReactNode;
}) {
  const { label, icon, value } = props;
  return (
    <Card className="flex items-center justify-between rounded-xl border-border/60 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className="mt-1 font-heading text-3xl font-bold tracking-tight text-foreground tabular-nums">
          {value}
        </div>
      </div>
      <div
        className="ml-4 flex size-11 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/30 text-muted-foreground"
        aria-hidden
      >
        {icon}
      </div>
    </Card>
  );
}

export type DataSourcesSummaryCardsProps = DataSourcesSummary;

export function DataSourcesSummaryCards({
  configuredIntegrationsCount,
  liveDataSourceCount,
  catalogObjectTotal,
  catalogError,
  dataSourcesLoading,
  catalogLoading,
}: DataSourcesSummaryCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <MetricCard
        label="Integrations"
        icon={<Blocks className="size-5" strokeWidth={1.75} />}
        value={
          dataSourcesLoading ? (
            <Skeleton className="h-9 w-12" />
          ) : (
            configuredIntegrationsCount.toLocaleString()
          )
        }
      />
      <MetricCard
        label="Live data sources"
        icon={<CirclePlay className="size-5" strokeWidth={1.75} />}
        value={
          dataSourcesLoading ? (
            <Skeleton className="h-9 w-12" />
          ) : (
            liveDataSourceCount.toLocaleString()
          )
        }
      />
      <MetricCard
        label="Objects"
        icon={<Database className="size-5" strokeWidth={1.75} />}
        value={
          catalogLoading ? (
            <Skeleton className="h-9 w-16" />
          ) : catalogError ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            (catalogObjectTotal ?? 0).toLocaleString()
          )
        }
      />
    </div>
  );
}
