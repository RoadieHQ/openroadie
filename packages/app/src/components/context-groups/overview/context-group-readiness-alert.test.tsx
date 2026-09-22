import { render, screen } from '@testing-library/react';
import type { DatasourceFilter } from '../types';
import {
  ContextGroupReadinessAlert,
  ContextGroupReadinessBadge,
  getContextGroupReadinessState,
} from './context-group-readiness-alert';

function makeFilter(live: boolean): DatasourceFilter {
  return {
    datasourceId: crypto.randomUUID(),
    status: {
      live,
    },
  };
}

describe('ContextGroupReadinessAlert', () => {
  it('warns when no datasources are available', () => {
    render(
      <ContextGroupReadinessAlert
        datasources={[makeFilter(false), makeFilter(false)]}
      />,
    );

    expect(
      screen.getByText('No data sources are available'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Context groups need at least one available data source/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Please enable, configure, or sync a data source\./i),
    ).toBeInTheDocument();
  });

  it('does not warn when at least one datasource is available', () => {
    const { rerender } = render(
      <ContextGroupReadinessAlert
        datasources={[makeFilter(true), makeFilter(false)]}
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    rerender(<ContextGroupReadinessAlert datasources={[makeFilter(true)]} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders a compact incomplete badge for list rows', () => {
    const { rerender } = render(
      <ContextGroupReadinessBadge datasources={[makeFilter(false)]} />,
    );

    expect(screen.getByText('Incomplete')).toBeInTheDocument();

    rerender(
      <ContextGroupReadinessBadge
        datasources={[makeFilter(true), makeFilter(false)]}
      />,
    );

    expect(screen.queryByText('Incomplete')).not.toBeInTheDocument();
  });
});

describe('getContextGroupReadinessState', () => {
  it('treats one available datasource as complete', () => {
    expect(
      getContextGroupReadinessState([makeFilter(true), makeFilter(false)]),
    ).toBeNull();
  });

  it('treats an empty datasource list as incomplete', () => {
    expect(getContextGroupReadinessState([])).toMatchObject({
      title: 'No data sources are available',
    });
  });
});
