// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { Button } from '@roadiehq/ui/button';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { RelationshipsPage } from './relationships-page';
import { createTestQueryClient } from '../../test-utils';
import { queryKeys } from '../../api/queries';

const mockWorkflowApi = {
  workflows: {
    update: vi.fn(),
    delete: vi.fn(),
  },
};

const mockAlertApi = { post: vi.fn() };

vi.mock('../../api', () => ({
  useWorkflows: () => mockWorkflowApi,
  useAlert: () => mockAlertApi,
}));

const mockRefetchDataSources = vi.fn();
const mockUseDataSources = vi.fn();
vi.mock('../data-sources/use-data-sources', () => ({
  useDataSources: (...args: unknown[]) => mockUseDataSources(...args),
}));

vi.mock('../data-sources/use-datastore-schemas', () => ({
  useDatastoreSchemas: () => ({ schemas: [] }),
}));

let mockRulesError: Error | undefined;
let mockRules: Array<{
  id: string;
  sourceDatasourceId: string;
  targetDatasourceId: string;
}>;
let queryClient: QueryClient;

vi.mock('../data-sources/use-relationship-rules', () => ({
  useRelationshipRules: () => ({
    rules: mockRules,
    error: mockRulesError,
  }),
}));

let capturedOnSetEnabled: ((id: string, enabled: boolean) => void) | undefined;
let capturedOnSaveStatusChange: ((status: string) => void) | undefined;
let capturedGraphProps:
  | {
      onDeleteDataSource?: (id: string) => Promise<void>;
      scopedDataSourceIds?: string[] | null;
      relationshipTypeFilter?: string[] | null;
      relationshipRuleFilter?: string[] | null;
      focusedRelationshipRuleId?: string | null;
    }
  | undefined;
let capturedFilterBarProps:
  | {
      rules?: Array<{ id: string }>;
      scopedDataSourceIds: string[];
      relationshipTypes: string[];
      relationshipRuleIds: string[];
      onScopedDataSourceIdsChange: (ids: string[]) => void;
      onRelationshipsChange: (next: {
        types: string[];
        ruleIds: string[];
      }) => void;
      onClearFilters: () => void;
    }
  | undefined;

vi.mock('../data-sources/relationships-editor', () => ({
  DataSourcesGraphView: (props: {
    onSetDataSourceEnabled: (id: string, enabled: boolean) => void;
    onSaveStatusChange: (status: string) => void;
    onDeleteDataSource?: (id: string) => Promise<void>;
  }) => {
    capturedOnSetEnabled = props.onSetDataSourceEnabled;
    capturedOnSaveStatusChange = props.onSaveStatusChange;
    capturedGraphProps = props;
    return <div data-testid="graph-view">DataSourcesGraphView</div>;
  },
  RelationshipsFilterBar: (props: {
    rules?: Array<{ id: string }>;
    scopedDataSourceIds: string[];
    relationshipTypes: string[];
    relationshipRuleIds: string[];
    onScopedDataSourceIdsChange: (ids: string[]) => void;
    onRelationshipsChange: (next: {
      types: string[];
      ruleIds: string[];
    }) => void;
    onClearFilters: () => void;
  }) => {
    capturedFilterBarProps = props;
    return (
      <div data-testid="filter-bar">
        <Button
          type="button"
          onClick={() => props.onScopedDataSourceIdsChange(['ds-9'])}
        >
          Set scope
        </Button>
        <Button
          type="button"
          onClick={() =>
            props.onRelationshipsChange({
              types: ['ownedBy'],
              ruleIds: ['rule-1'],
            })
          }
        >
          Set relationships
        </Button>
        <Button type="button" onClick={() => props.onClearFilters()}>
          Clear filters
        </Button>
      </div>
    );
  },
  DEFAULT_EDITOR_MODE: 'edit',
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <div data-testid="location-pathname">{location.pathname}</div>
      <div data-testid="location-search">{location.search}</div>
    </>
  );
}

function renderPage(initialEntry = '/relationships') {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <RelationshipsPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = createTestQueryClient();
  mockRulesError = undefined;
  mockRules = [
    {
      id: 'rule-1',
      sourceDatasourceId: 'ds-1',
      targetDatasourceId: 'ds-2',
    },
    {
      id: 'rule-2',
      sourceDatasourceId: 'ds-2',
      targetDatasourceId: 'ds-3',
    },
    {
      id: 'rule-3',
      sourceDatasourceId: 'ds-1',
      targetDatasourceId: 'ds-3',
    },
  ];
  capturedOnSetEnabled = undefined;
  capturedOnSaveStatusChange = undefined;
  capturedGraphProps = undefined;
  capturedFilterBarProps = undefined;
  mockUseDataSources.mockReturnValue({
    dataSources: [
      { id: 'ds-1', name: 'DS 1', enabled: true },
      { id: 'ds-2', name: 'DS 2', enabled: true },
      { id: 'ds-3', name: 'DS 3', enabled: true },
    ],
    loading: false,
    refetch: mockRefetchDataSources,
  });
});

afterEach(() => {
  cleanup();
});

describe('RelationshipsPage', () => {
  describe('rendering', () => {
    it('guides first-time users to create a data source instead of rendering the editor', async () => {
      const user = userEvent.setup();
      mockUseDataSources.mockReturnValue({
        dataSources: [],
        loading: false,
        error: undefined,
        refetch: mockRefetchDataSources,
      });

      renderPage();

      expect(
        screen.getByRole('heading', {
          name: 'No data sources to connect yet',
        }),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'New Data Source' }));
      expect(screen.getByTestId('location-pathname')).toHaveTextContent(
        '/data-sources',
      );
      expect(screen.getByTestId('location-search')).toHaveTextContent('?new=1');
      expect(screen.queryByTestId('filter-bar')).toBeNull();
      expect(screen.queryByTestId('graph-view')).toBeNull();
    });

    it('renders header, description, and graph view, loading data sources without execution summaries', () => {
      renderPage();
      expect(mockUseDataSources).toHaveBeenCalledWith({
        skipExecutions: true,
      });
      expect(
        screen.getAllByRole('heading', { name: 'Relationships' }).length,
      ).toBeGreaterThanOrEqual(1);
      const description = screen.getByText(
        'Visualize and edit how your data sources connect.',
      );
      expect(description).toBeInTheDocument();
      expect(description.closest('.sticky')).toHaveClass(
        'h-[70px]',
        'border-b',
      );
      expect(screen.getByTestId('graph-view')).toBeInTheDocument();
    });

    it('redirects legacy ?focus links to the datastore graph page, keeping focus and depth', () => {
      renderPage('/relationships?focus=ds-uuid:v2%3Ap%3Aobj&depth=3');

      expect(screen.queryByTestId('graph-view')).toBeNull();
      expect(screen.getByTestId('location-pathname')).toHaveTextContent(
        '/datastore/graph',
      );
      const search = screen.getByTestId('location-search').textContent ?? '';
      const params = new URLSearchParams(search.replace(/^\?/, ''));
      expect(params.get('focus')).toBe('ds-uuid:v2:p:obj');
      expect(params.get('depth')).toBe('3');
    });

    it('redirects legacy ?focus links without a depth param', () => {
      renderPage('/relationships?focus=a:b');

      expect(screen.getByTestId('location-pathname')).toHaveTextContent(
        '/datastore/graph',
      );
      const search = screen.getByTestId('location-search').textContent ?? '';
      const params = new URLSearchParams(search.replace(/^\?/, ''));
      expect(params.get('focus')).toBe('a:b');
      expect(params.get('depth')).toBeNull();
    });

    it('propagates datasource deletion failures after reporting them', async () => {
      const error = new Error('delete failed');
      mockWorkflowApi.workflows.delete.mockRejectedValueOnce(error);
      renderPage();

      await expect(
        capturedGraphProps?.onDeleteDataSource?.('datasource-1'),
      ).rejects.toThrow(error);
      expect(mockAlertApi.post).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Failed to delete data source'),
          severity: 'error',
        }),
      );
    });
  });

  describe('scope and relationship filters', () => {
    it('parses ds/reltype/rel/relFocus params and threads them to the graph', () => {
      renderPage(
        '/relationships?ds=ds-1,ds-2&reltype=ownedBy,partOf&rel=rule-1&relFocus=rule-9',
      );

      expect(capturedGraphProps?.scopedDataSourceIds).toEqual(['ds-1', 'ds-2']);
      expect(capturedGraphProps?.relationshipTypeFilter).toEqual([
        'ownedBy',
        'partOf',
      ]);
      expect(capturedGraphProps?.relationshipRuleFilter).toEqual(['rule-1']);
      expect(capturedGraphProps?.focusedRelationshipRuleId).toBe('rule-9');
      expect(capturedFilterBarProps?.scopedDataSourceIds).toEqual([
        'ds-1',
        'ds-2',
      ]);
    });

    it('limits relationship options to the current scoped datasource view', () => {
      renderPage('/relationships?ds=ds-1,ds-2');

      expect(capturedFilterBarProps?.rules?.map(rule => rule.id)).toEqual([
        'rule-1',
      ]);
    });

    it('passes null scope to the graph when no ds param is present', () => {
      renderPage('/relationships');
      expect(capturedGraphProps?.scopedDataSourceIds).toBeNull();
      expect(capturedFilterBarProps?.scopedDataSourceIds).toEqual([]);
    });

    it('writes the data-source scope to the ds param', async () => {
      const user = userEvent.setup();
      renderPage('/relationships');

      await user.click(screen.getByRole('button', { name: 'Set scope' }));

      const search = screen.getByTestId('location-search').textContent ?? '';
      const params = new URLSearchParams(search.replace(/^\?/, ''));
      expect(params.get('ds')).toBe('ds-9');
    });

    it('writes relationship type and rule selections to reltype/rel', async () => {
      const user = userEvent.setup();
      renderPage('/relationships');

      await user.click(
        screen.getByRole('button', { name: 'Set relationships' }),
      );

      const search = screen.getByTestId('location-search').textContent ?? '';
      const params = new URLSearchParams(search.replace(/^\?/, ''));
      expect(params.get('reltype')).toBe('ownedBy');
      expect(params.get('rel')).toBe('rule-1');
    });

    it('clears relFocus when relationship filters change', async () => {
      const user = userEvent.setup();
      renderPage('/relationships?relFocus=rule-9&reltype=ownedBy&rel=rule-1');

      await user.click(
        screen.getByRole('button', { name: 'Set relationships' }),
      );

      const search = screen.getByTestId('location-search').textContent ?? '';
      const params = new URLSearchParams(search.replace(/^\?/, ''));
      expect(params.get('relFocus')).toBeNull();
    });

    it('clears all filter params but keeps unrelated params', async () => {
      const user = userEvent.setup();
      renderPage(
        '/relationships?ds=ds-1&reltype=ownedBy&rel=rule-1&relFocus=rule-9&keep=true',
      );

      await user.click(screen.getByRole('button', { name: 'Clear filters' }));

      const search = screen.getByTestId('location-search').textContent ?? '';
      const params = new URLSearchParams(search.replace(/^\?/, ''));
      expect(params.get('ds')).toBeNull();
      expect(params.get('reltype')).toBeNull();
      expect(params.get('rel')).toBeNull();
      expect(params.get('relFocus')).toBeNull();
      expect(params.get('keep')).toBe('true');
    });
  });

  describe('data source enable toggle', () => {
    it('calls workflows.update and invalidates data sources on enable', async () => {
      mockWorkflowApi.workflows.update.mockResolvedValue(undefined);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      renderPage();
      capturedOnSetEnabled!('ds-1', true);
      await waitFor(() => {
        expect(mockWorkflowApi.workflows.update).toHaveBeenCalledWith('ds-1', {
          enabled: true,
        });
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.dataIngestionWorkflows,
      });
      expect(mockAlertApi.post).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Data source enabled',
          severity: 'success',
        }),
      );
    });

    it('shows disable message when disabling', async () => {
      mockWorkflowApi.workflows.update.mockResolvedValue(undefined);
      renderPage();
      capturedOnSetEnabled!('ds-1', false);
      await waitFor(() => {
        expect(mockAlertApi.post).toHaveBeenCalledWith(
          expect.objectContaining({
            message: 'Data source disabled',
            severity: 'success',
          }),
        );
      });
    });

    it('shows error alert when enable fails', async () => {
      mockWorkflowApi.workflows.update.mockRejectedValue(
        new Error('Server error'),
      );
      renderPage();
      capturedOnSetEnabled!('ds-1', true);
      await waitFor(() => {
        expect(mockAlertApi.post).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining('Server error'),
            severity: 'error',
          }),
        );
      });
    });
  });

  describe('save status indicator', () => {
    it('renders nothing while idle', () => {
      renderPage();
      expect(screen.queryByText('Unsaved changes')).toBeNull();
      expect(screen.queryByText('Saving…')).toBeNull();
      expect(screen.queryByText('Saved')).toBeNull();
    });

    it.each([
      ['pending', 'Unsaved changes'],
      ['saving', 'Saving…'],
      ['saved', 'Saved'],
      ['error', 'Save failed'],
    ])('shows "%s" status as "%s"', (status, label) => {
      renderPage();
      act(() => capturedOnSaveStatusChange!(status));
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  describe('rules error', () => {
    it('shows error alert when rules fail to load', () => {
      mockRulesError = new Error('Rules fetch failed');
      renderPage();
      expect(mockAlertApi.post).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Rules fetch failed'),
          severity: 'error',
        }),
      );
    });
  });
});
