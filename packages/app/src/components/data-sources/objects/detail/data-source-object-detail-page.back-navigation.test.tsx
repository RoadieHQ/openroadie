import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestQueryProvider } from '../../../../test-utils';
import { DataSourceObjectDetailPage } from './data-source-object-detail-page';

const objectId = '5ec1524b-8bc5-4b89-9dba-c78ea77f5b10';

const mockDatastoreApi = {
  getObject: vi.fn(),
  findContextGroupsByMember: vi.fn(),
  createRelationship: vi.fn(),
  deleteRelationship: vi.fn(),
  listRelationshipRules: vi.fn(),
};

const mockUseDataSources = vi.fn();

vi.mock('../../../../api', () => ({
  useDatastore: () => mockDatastoreApi,
  useAlert: () => ({ post: vi.fn() }),
}));

vi.mock('../../use-data-sources', () => ({
  useDataSources: (...args: unknown[]) => mockUseDataSources(...args),
}));

function renderPage() {
  return render(
    <TestQueryProvider>
      <MemoryRouter
        initialEntries={[
          '/datastore?dataSourceId=ds-shortcut',
          `/datastore/ds-shortcut/${objectId}`,
        ]}
        initialIndex={1}
      >
        <Routes>
          <Route path="/datastore" element={<div>OBJECT LIST</div>} />
          <Route
            path="/datastore/:datasourceId/:objectId"
            element={<DataSourceObjectDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseDataSources.mockReturnValue({
    dataSources: [{ id: 'ds-shortcut', name: 'Shortcut members' }],
    loading: false,
    error: undefined,
    refetch: vi.fn(),
    noteRunStarted: vi.fn(),
  });
  mockDatastoreApi.findContextGroupsByMember.mockResolvedValue([]);
  mockDatastoreApi.getObject.mockResolvedValue({
    id: 'stored-object-id',
    datasourceId: 'ds-shortcut',
    objectId,
    object: { name: 'Alice Example' },
    createdAt: '2026-06-01T09:00:00Z',
    updatedAt: '2026-06-15T10:30:00Z',
    relationships: [],
  });
  mockDatastoreApi.createRelationship.mockResolvedValue({ id: 'rel-new' });
  mockDatastoreApi.deleteRelationship.mockResolvedValue(undefined);
  mockDatastoreApi.listRelationshipRules.mockResolvedValue({
    items: [],
    total: 0,
  });
});

describe('DataSourceObjectDetailPage back navigation', () => {
  it('uses browser back when history is available', async () => {
    const user = userEvent.setup();
    window.history.replaceState({ idx: 1 }, '');

    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Alice Example' });
    await user.click(screen.getByRole('link', { name: 'Back' }));

    expect(await screen.findByText('OBJECT LIST')).not.toBeNull();
  });
});
