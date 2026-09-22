import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiContext, type ApiClients } from '../../../api';
import type { IndexConfiguration } from '../../../api/datastore/datastore-client';
import { DataSourceObjectsTable } from './data-source-objects-table';
import type { DataSourceObjectRow } from './use-data-source-objects';
import type { DataSourceItem } from '../types';

/**
 * The column filter typeahead reads candidate values from the datastore client,
 * so the table needs both a query client and the API context even when no
 * popover is open.
 */
const SUGGESTIONS = ['eu-west-1', 'us-east-1', 'ap-southeast-2'];

function StoryProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
      }),
  );
  // `CatalogDatastoreClient` is a class with private fields, so no object
  // literal is structurally comparable to it. Attaching the two methods the
  // filter typeahead calls onto an empty client keeps this to one assertion
  // instead of an `as unknown as` bridge.
  const apis = Object.assign({} as ApiClients, {
    datastore: Object.assign({} as ApiClients['datastore'], {
      listIndexValues: () => Promise.resolve(SUGGESTIONS),
      listContextGroupTitles: () => Promise.resolve(['Platform', 'Payments']),
    }),
  });
  return (
    <QueryClientProvider client={client}>
      <ApiContext.Provider value={apis}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  );
}

const indexes: IndexConfiguration[] = [
  {
    id: 'i-title',
    datasourceId: 'ds-1',
    key: 'presentation.title',
    valueExpression: 'full_name',
    purpose: 'title',
  },
  {
    id: 'i-subtitle',
    datasourceId: 'ds-1',
    key: 'presentation.subtitle',
    valueExpression: 'language',
    purpose: 'subtitle',
  },
  {
    id: 'i-region',
    datasourceId: 'ds-1',
    key: 'region',
    valueExpression: 'region',
  },
  {
    id: 'i-visibility',
    datasourceId: 'ds-1',
    key: 'visibility',
    valueExpression: 'visibility',
  },
];

function row(
  overrides: Partial<DataSourceObjectRow> & { id: string },
): DataSourceObjectRow {
  return {
    datasourceId: 'ds-1',
    objectId: overrides.id,
    object: {},
    createdAt: '2026-07-01T10:00:00Z',
    updatedAt: '2026-07-28T09:30:00Z',
    relationshipCount: 0,
    indexValues: new Map(),
    ...overrides,
  } as DataSourceObjectRow;
}

const rows: DataSourceObjectRow[] = [
  row({
    id: 'RoadieHQ/openroadie',
    object: {
      full_name: 'RoadieHQ/openroadie',
      language: 'TypeScript',
      region: 'eu-west-1',
      visibility: 'private',
    },
    presentation: {
      title: 'RoadieHQ/openroadie',
      subtitle: 'TypeScript',
    },
    relationshipCount: 12,
    contextGroups: [
      { groupId: 'g-1', ruleId: 'r-1', ruleName: 'Teams', title: 'Platform' },
      { groupId: 'g-2', ruleId: 'r-1', ruleName: 'Teams', title: 'Payments' },
      {
        groupId: 'g-3',
        ruleId: 'r-1',
        ruleName: 'Teams',
        title: 'Developer Experience',
      },
    ],
    indexValues: new Map([
      ['presentation.title', 'RoadieHQ/openroadie'],
      ['presentation.subtitle', 'TypeScript'],
      ['region', 'eu-west-1'],
      ['visibility', 'private'],
    ]),
  }),
  row({
    id: 'RoadieHQ/backstage-plugins',
    object: {
      full_name: 'RoadieHQ/backstage-plugins',
      language: 'TypeScript',
      region: 'us-east-1',
      visibility: 'public',
    },
    presentation: {
      title: 'RoadieHQ/backstage-plugins',
      subtitle: 'TypeScript',
    },
    relationshipCount: 3,
    contextGroups: [
      { groupId: 'g-1', ruleId: 'r-1', ruleName: 'Teams', title: 'Platform' },
    ],
    indexValues: new Map([
      ['presentation.title', 'RoadieHQ/backstage-plugins'],
      ['presentation.subtitle', 'TypeScript'],
      ['region', 'us-east-1'],
      ['visibility', 'public'],
    ]),
  }),
  row({
    // No presentation and no relationships: the fallbacks (object id as title,
    // em dashes) are the common shape for a freshly ingested source.
    id: 'orphan-object-42',
    object: { region: 'ap-southeast-2' },
    indexValues: new Map([['region', 'ap-southeast-2']]),
  }),
];

const meta = {
  title: 'DataSources/DataSourceObjectsTable',
  component: DataSourceObjectsTable,
  parameters: { layout: 'fullscreen' },
  decorators: [
    Story => (
      <StoryProviders>
        <div className="flex h-[32rem] flex-col p-4">
          <Story />
        </div>
      </StoryProviders>
    ),
  ],
  args: {
    datasourceId: 'ds-1',
    allMode: false,
    dataSources: [
      { id: 'ds-1', name: 'GitHub Repositories' },
      { id: 'ds-2', name: 'Jira Issues' },
    ] as DataSourceItem[],
    rows,
    indexes,
    total: rows.length,
    loading: false,
    searchActive: false,
    sorting: [],
    onSortingChange: fn(),
    pagination: { pageIndex: 0, pageSize: 25 },
    onPaginationChange: fn(),
    filters: new Map(),
    onSetFilter: fn(),
    columnVisibility: {},
    onColumnVisibilityChange: fn(),
    onOpenObject: fn(),
  },
} satisfies Meta<typeof DataSourceObjectsTable>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One data source: headers named after their source field, index columns present. */
export const Default: Story = {};

/** An active exact-match filter — the column's filter icon stays lit. */
export const Filtered: Story = {
  args: {
    filters: new Map([['region', 'eu-west-1']]),
    rows: [rows[0]],
    total: 1,
  },
};

/**
 * Cross-source scope: gains a Data source column, drops the index columns (the
 * sources share no schema) and keeps the generic Title / Secondary labels.
 */
export const CrossSource: Story = {
  args: {
    allMode: true,
    datasourceId: 'all',
    rows: [
      rows[0],
      row({
        id: 'PROJ-114',
        datasourceId: 'ds-2',
        object: { summary: 'Fix login redirect', status: 'In Progress' },
        presentation: { title: 'Fix login redirect', subtitle: 'In Progress' },
        relationshipCount: 1,
      }),
    ],
    total: 2,
  },
};

/**
 * Relevance-ranked results, so sorting and filtering are both off and
 * relationship counts are unavailable.
 */
export const Searching: Story = {
  args: { searchActive: true, rows: [rows[0]], total: 1 },
};

/**
 * A sort, filter or page change with rows already up: they stay put and the pill
 * overlays the table, bottom-right so it clears the sticky header.
 */
export const Refreshing: Story = {
  args: { refreshing: true },
};

/** First load: the shared table-body skeleton at this table's row density. */
export const Loading: Story = {
  args: {
    loading: true,
    rows: [],
    total: 0,
    pagination: { pageIndex: 0, pageSize: 6 },
  },
};

export const Empty: Story = {
  args: { rows: [], total: 0 },
};
