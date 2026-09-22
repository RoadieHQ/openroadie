import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { TestQueryProvider } from '../../test-utils';
import { McpAuditLogPage } from './mcp-audit-log-page';
import type {
  McpAuditLogEntry,
  McpAuditLogResponse,
} from '../../api/mcp-audit';
import type { CorrelationGroup } from './types';

const mockAuditClient = {
  getAuditLog: vi.fn(),
  getFacets: vi.fn(),
};
const mockServiceTokensClient = {
  list: () => Promise.resolve({ tokens: [] }),
};

vi.mock('../../api', () => ({
  useMcpAudit: () => mockAuditClient,
  useServiceTokens: () => mockServiceTokensClient,
}));

vi.mock('./session-list', () => ({
  SessionList: ({ groups }: { groups: CorrelationGroup[] }) => (
    <div data-testid="session-list">
      {groups.map(g => g.correlationId).join(',')}
    </div>
  ),
}));

vi.mock('./session-detail', () => ({
  SessionDetail: () => <div data-testid="session-detail" />,
}));

function makeEntry(overrides?: Partial<McpAuditLogEntry>): McpAuditLogEntry {
  return {
    id: 'entry-1',
    correlationId: 'corr-1',
    service: 'catalog',
    tool: 'catalog-search',
    status: 'success',
    durationMs: 12,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeResponse(
  correlationId: string,
  totalCount = 1,
): McpAuditLogResponse {
  return {
    items: [makeEntry({ id: `entry-${correlationId}`, correlationId })],
    totalCount,
  };
}

function deferred() {
  let resolve!: (value: McpAuditLogResponse) => void;
  const promise = new Promise<McpAuditLogResponse>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

const emptyFacets = {
  services: [],
  tools: [],
  users: [],
  escalationCount: 0,
  totalSessionCount: 0,
};

async function flushTimers(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function searchField() {
  return screen.getByRole('searchbox', { name: 'Search audit log' });
}

function LocationProbe() {
  return <div data-testid="location-pathname">{useLocation().pathname}</div>;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <McpAuditLogPage />
      <LocationProbe />
    </MemoryRouter>,
    { wrapper: TestQueryProvider },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockAuditClient.getFacets.mockResolvedValue(emptyFacets);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('McpAuditLogPage', () => {
  it('guides first-time users to connect an MCP client', async () => {
    mockAuditClient.getAuditLog.mockResolvedValue({
      items: [],
      totalCount: 0,
    });

    renderPage();
    await flushTimers();

    expect(
      screen.getByRole('heading', { name: 'No agent sessions yet' }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect an MCP client' }),
    );
    expect(screen.getByTestId('location-pathname')).toHaveTextContent(
      '/admin/mcp-servers',
    );
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('keeps refresh available when the first audit request fails', async () => {
    mockAuditClient.getAuditLog.mockRejectedValue(
      new Error('Audit log unavailable'),
    );

    renderPage();
    await flushTimers();

    expect(screen.getByText('Audit log unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('ignores a stale response that resolves after a newer request', async () => {
    const requestA = deferred();
    const requestB = deferred();
    mockAuditClient.getAuditLog
      .mockResolvedValueOnce(makeResponse('corr-initial'))
      .mockReturnValueOnce(requestA.promise)
      .mockReturnValueOnce(requestB.promise);

    renderPage();
    await flushTimers();
    expect(screen.getByTestId('session-list')).toHaveTextContent(
      'corr-initial',
    );

    fireEvent.change(searchField(), { target: { value: 'a' } });
    await flushTimers(300);
    fireEvent.change(searchField(), { target: { value: 'ab' } });
    await flushTimers(300);
    expect(mockAuditClient.getAuditLog).toHaveBeenCalledTimes(3);

    await act(async () => {
      requestB.resolve(makeResponse('corr-latest'));
      // React Query batches notifications through setTimeout(0).
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('session-list')).toHaveTextContent('corr-latest');

    await act(async () => {
      requestA.resolve(makeResponse('corr-stale'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('session-list')).toHaveTextContent('corr-latest');
    expect(screen.getByTestId('session-list')).not.toHaveTextContent(
      'corr-stale',
    );
  });

  it('debounces search input into a single fetch and resets to the first page', async () => {
    mockAuditClient.getAuditLog.mockResolvedValue(makeResponse('corr-1', 60));

    renderPage();
    await flushTimers();
    expect(screen.getByTestId('session-list')).toBeInTheDocument();
    expect(mockAuditClient.getAuditLog).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await flushTimers();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(mockAuditClient.getAuditLog).toHaveBeenCalledTimes(2);
    expect(mockAuditClient.getAuditLog).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 }),
    );

    for (const value of ['a', 'ab', 'abc']) {
      fireEvent.change(searchField(), { target: { value } });
      await flushTimers(100);
    }
    expect(mockAuditClient.getAuditLog).toHaveBeenCalledTimes(2);

    await flushTimers(300);
    expect(mockAuditClient.getAuditLog).toHaveBeenCalledTimes(3);
    expect(mockAuditClient.getAuditLog).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 0, search: 'abc' }),
    );
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
  });
});
