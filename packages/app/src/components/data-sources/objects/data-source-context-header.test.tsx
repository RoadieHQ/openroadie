import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { DataSourceContextHeader } from './data-source-context-header';
import type { DataSourceItem, ExecutionInfo } from '../types';

function makeDataSource(execution?: ExecutionInfo): DataSourceItem {
  return {
    id: 'ds-1',
    name: 'GitHub Repositories',
    slug: 'github-repositories',
    logoUrl: '',
    execution,
  } as DataSourceItem;
}

function renderHeader(dataSource: DataSourceItem) {
  return render(
    <MemoryRouter>
      <DataSourceContextHeader
        dataSource={dataSource}
        total={3}
        searchActive={false}
      />
    </MemoryRouter>,
  );
}

describe('DataSourceContextHeader last-run chip', () => {
  it('shows "Running…" for an in-flight run instead of a completed last-run label', () => {
    renderHeader(
      makeDataSource({
        status: 'running',
        lastRunAt: '2026-08-21T09:00:00Z',
      }),
    );
    expect(screen.getByText('Running…')).toBeInTheDocument();
    expect(screen.queryByText(/^Last run/)).not.toBeInTheDocument();
  });

  it('shows "Running…" for a running source that has no last-run time yet', () => {
    renderHeader(makeDataSource({ status: 'running' }));
    expect(screen.getByText('Running…')).toBeInTheDocument();
    expect(screen.queryByText('Never run')).not.toBeInTheDocument();
  });

  it('shows a completed last-run label for a finished run', () => {
    renderHeader(
      makeDataSource({
        status: 'completed',
        lastRunAt: '2026-08-21T09:00:00Z',
      }),
    );
    expect(screen.getByText(/^Last run/)).toBeInTheDocument();
    expect(screen.queryByText('Running…')).not.toBeInTheDocument();
  });
});
