import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestQueryProvider } from '../../../test-utils';
import { ContextGroupInstancePage } from './context-group-instance-page';

const mockDatastoreApi = {
  getContextGroupBundle: vi.fn(),
};

const mockAuditApi = {
  getAuditLog: vi.fn(),
};

const mockUseDataSources = vi.fn();

vi.mock('../../../api', () => ({
  useDatastore: () => mockDatastoreApi,
  useMcpAudit: () => mockAuditApi,
}));

vi.mock('../../data-sources/use-data-sources', () => ({
  useDataSources: (...args: unknown[]) => mockUseDataSources(...args),
}));

function renderPage(
  initialEntries: string[] = [
    '/context-groups/details/rule-1',
    '/context-groups/groups/group-1',
  ],
  initialIndex = 1,
) {
  return render(
    <TestQueryProvider>
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
        <Routes>
          <Route
            path="/context-groups/details/:groupId"
            element={<div>RULE DETAIL</div>}
          />
          <Route
            path="/context-groups/groups/:groupId"
            element={<ContextGroupInstancePage />}
          />
        </Routes>
      </MemoryRouter>
    </TestQueryProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseDataSources.mockReturnValue({
    dataSources: [{ id: 'ds-1', name: 'People', enabled: true }],
  });
  mockDatastoreApi.getContextGroupBundle.mockResolvedValue({
    id: 'group-1',
    ruleId: 'rule-1',
    ruleName: 'People',
    title: 'jain@example.com',
    datasourceIds: ['ds-1'],
    members: [],
    internalRelationships: [],
    externalRelationships: [],
    totalMembers: 0,
    totalInternalRelationships: 0,
    totalExternalRelationships: 0,
  });
  mockAuditApi.getAuditLog.mockResolvedValue({ items: [] });
});

describe('ContextGroupInstancePage', () => {
  it('uses browser back when history is available', async () => {
    const user = userEvent.setup();
    window.history.replaceState({ idx: 1 }, '');

    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'jain@example.com' });
    await user.click(screen.getByRole('link', { name: 'Back' }));

    expect(await screen.findByText('RULE DETAIL')).not.toBeNull();
  });

  it('shows additional data sources in a bounded popover', async () => {
    const user = userEvent.setup();
    mockUseDataSources.mockReturnValue({
      dataSources: [
        { id: 'ds-1', name: 'People', enabled: true },
        { id: 'ds-2', name: 'Teams', enabled: true },
        { id: 'ds-3', name: 'Services', enabled: true },
        { id: 'ds-4', name: 'Systems', enabled: true },
      ],
    });
    mockDatastoreApi.getContextGroupBundle.mockResolvedValue({
      id: 'group-1',
      ruleId: 'rule-1',
      ruleName: 'People',
      title: 'jain@example.com',
      datasourceIds: ['ds-1', 'ds-2', 'ds-3', 'ds-4'],
      members: [],
      internalRelationships: [],
      externalRelationships: [],
      totalMembers: 0,
      totalInternalRelationships: 0,
      totalExternalRelationships: 0,
    });

    renderPage();

    await user.click(
      await screen.findByRole('button', {
        name: 'Show 2 more data sources',
      }),
    );

    expect(screen.getByText('Additional data sources')).not.toBeNull();
    expect(screen.getByText('Services')).not.toBeNull();
    expect(screen.getByText('Systems')).not.toBeNull();
  });
});
