import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@roadiehq/ui/alert';
import { Badge } from '@roadiehq/ui/badge';
import type { DatasourceFilter } from '../types';

function availableDatasourceCount(filters: DatasourceFilter[]): number {
  return filters.filter(filter => filter.status?.live).length;
}

interface ContextGroupReadinessState {
  title: string;
  description: string;
}

const NO_AVAILABLE_DATASOURCES_DESCRIPTION =
  'Context groups need at least one available data source. Please enable, configure, or sync a data source.';

export function getContextGroupReadinessState(
  datasources: DatasourceFilter[],
): ContextGroupReadinessState | null {
  if (availableDatasourceCount(datasources) === 0) {
    return {
      title: 'No data sources are available',
      description: NO_AVAILABLE_DATASOURCES_DESCRIPTION,
    };
  }

  return null;
}

export function ContextGroupReadinessBadge({
  datasources,
}: {
  datasources: DatasourceFilter[];
}) {
  const readiness = getContextGroupReadinessState(datasources);

  if (!readiness) {
    return null;
  }

  return (
    <Badge
      variant="warningSubtle"
      icon={<AlertTriangle />}
      className="w-fit gap-1.5 rounded-full whitespace-nowrap"
      title={readiness.description}
    >
      Incomplete
    </Badge>
  );
}

export function ContextGroupReadinessAlert({
  datasources,
}: {
  datasources: DatasourceFilter[];
}) {
  const readiness = getContextGroupReadinessState(datasources);

  if (!readiness) {
    return null;
  }

  return (
    <Alert variant="default" className="border-warning/40 bg-warning/10">
      <AlertTriangle className="size-4 text-warning" />
      <AlertTitle>{readiness.title}</AlertTitle>
      <AlertDescription>{readiness.description}</AlertDescription>
    </Alert>
  );
}
