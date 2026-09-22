import { Suspense, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { Skeleton } from '@roadiehq/ui/skeleton';
import { OverviewListingStandaloneBody } from './overview-listing-layout';
import { OverviewListingPageHeaderSkeleton } from './overview-listing-header-skeleton';
import { useDelayedFlag } from './use-delayed-flag';
import { ACTIONS_COLUMN_WIDTHS } from '../actions/overview/actions-table-layout';
import { CAPABILITIES_COLUMN_WIDTHS } from '../capabilities/overview/capabilities-table-layout';
import { CONTEXT_GROUPS_COLUMN_WIDTHS } from '../context-groups/overview/context-groups-table-layout';
import { DATA_SOURCES_COLUMN_WIDTHS } from '../data-sources/overview/data-sources-table-layout';
import { dataSourceObjectsColumnWidths } from '../data-sources/objects/data-source-objects-table-layout';
import {
  isCrossSourceScope,
  readDatastoreScopeFromParams,
} from '../data-sources/objects/datastore-scope-param';
import { getIntegrationsColumnWidths } from '../integrations/overview/integrations-table-layout';
import { OVERVIEW_ALL_GROUP } from '../overview';
import { OverviewTableLoadingView } from '../overview/overview-table-loading-view';
import { SECRETS_COLUMN_WIDTHS } from '../secrets/secrets-table-layout';
import { TEAMS_COLUMN_WIDTHS } from '../teams/overview/teams-table-layout';
import { WORKSPACES_COLUMN_WIDTHS } from '../workspaces/overview/workspaces-table-layout';

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/**
 * Renders nothing until the shared delayed loading gate trips. Used to gate the
 * route-level Suspense fallback so a fast chunk load resolves before the
 * skeleton ever appears — no flash. (Suspense can't enforce a minimum-visible
 * window, so this is delay-only; the in-component skeleton adds the min-visible
 * half via `useDelayedFlag`.)
 */
function DelayedFallback({ children }: { children: ReactNode }) {
  const show = useDelayedFlag(true);
  return show ? <>{children}</> : null;
}

/**
 * Every sidebar route that lands on an overview table (the shared
 * `OverviewTable`). The route-level Suspense fallback renders the SAME generic
 * table skeleton the page shows in-component, so the chunk-load → data-fetch →
 * table transition is seamless and every overview-table route looks identical
 * while loading. `columnWidths` comes from each page's table-layout constants,
 * so the skeleton's columns line up with the real table.
 */
type ColumnWidthsResolver =
  | string[]
  | ((searchParams: URLSearchParams) => string[]);

interface OverviewTableRouteConfig {
  columnWidths: ColumnWidthsResolver;
  hasRowActions?: boolean;
  pageScroll?: boolean;
}

function resolveColumnWidths(
  resolver: ColumnWidthsResolver,
  searchParams: URLSearchParams,
): string[] {
  return typeof resolver === 'function' ? resolver(searchParams) : resolver;
}

const OVERVIEW_TABLE_ROUTES: Record<string, OverviewTableRouteConfig> = {
  '/data-sources': {
    columnWidths: DATA_SOURCES_COLUMN_WIDTHS,
    hasRowActions: true,
  },
  '/integrations': {
    columnWidths: searchParams =>
      getIntegrationsColumnWidths(
        searchParams.get('group') ?? OVERVIEW_ALL_GROUP,
      ),
    hasRowActions: true,
  },
  '/capabilities': {
    columnWidths: CAPABILITIES_COLUMN_WIDTHS,
    hasRowActions: true,
  },
  '/actions': {
    columnWidths: ACTIONS_COLUMN_WIDTHS,
    hasRowActions: true,
  },
  '/context-groups': {
    columnWidths: CONTEXT_GROUPS_COLUMN_WIDTHS,
    hasRowActions: true,
  },
  // The datastore objects table is bespoke rather than an OverviewTable, but it
  // is still an overview listing and shares the shell, so it gets the same
  // skeleton. Column set depends on the scope in the URL, exactly as the page's
  // own does; index columns can't be known this early (see the layout helper).
  '/datastore': {
    columnWidths: searchParams =>
      dataSourceObjectsColumnWidths(
        isCrossSourceScope(readDatastoreScopeFromParams(searchParams)),
      ),
  },
  // Both admin listings render in page-scroll mode (no pagination footer).
  '/admin/workspaces': {
    columnWidths: WORKSPACES_COLUMN_WIDTHS,
    hasRowActions: true,
    pageScroll: true,
  },
  '/admin/teams': {
    columnWidths: TEAMS_COLUMN_WIDTHS,
    hasRowActions: true,
    pageScroll: true,
  },
  '/admin/secrets': {
    columnWidths: SECRETS_COLUMN_WIDTHS,
    hasRowActions: true,
    pageScroll: true,
  },
};

function OverviewTableRouteFallback({
  columnWidths,
  hasRowActions,
  pageScroll,
}: {
  columnWidths: string[];
  hasRowActions?: boolean;
  pageScroll?: boolean;
}) {
  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <OverviewListingStandaloneBody className="flex min-h-0 flex-1 flex-col space-y-4 sm:space-y-6">
        <OverviewListingPageHeaderSkeleton />
        <OverviewTableLoadingView
          columnCount={columnWidths.length}
          columnWidths={columnWidths}
          hasRowActions={hasRowActions}
          pageScroll={pageScroll}
        />
      </OverviewListingStandaloneBody>
    </div>
  );
}

function DefaultRouteSuspenseFallback() {
  return (
    <div className="flex min-h-[50vh] flex-1 flex-col justify-center px-6 py-12">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <Skeleton className="h-9 w-2/5 max-w-[14rem]" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-36 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function RouteAdaptiveSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<RouteAdaptiveLoadingView />}>{children}</Suspense>
  );
}

export function RouteAdaptiveLoadingView() {
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const tableRoute = OVERVIEW_TABLE_ROUTES[normalizePath(pathname)];

  return (
    <DelayedFallback>
      {tableRoute ? (
        <OverviewTableRouteFallback
          {...tableRoute}
          columnWidths={resolveColumnWidths(
            tableRoute.columnWidths,
            searchParams,
          )}
        />
      ) : (
        <DefaultRouteSuspenseFallback />
      )}
    </DelayedFallback>
  );
}
