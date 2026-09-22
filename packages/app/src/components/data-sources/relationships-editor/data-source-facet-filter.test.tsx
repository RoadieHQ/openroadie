// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataSourceFacetFilter } from './data-source-facet-filter';
import type { DataSourceItem } from '../types';

const dataSources = [
  {
    id: 'ds-1',
    name: 'GitHub Users',
    enabled: true,
    logoUrl: '',
    integration: {
      type: 'github',
      label: 'GitHub',
      logoUrl: '',
      color: '',
      icon: '',
    },
  },
  {
    id: 'ds-2',
    name: 'GitHub Repos',
    enabled: true,
    logoUrl: '',
    integration: {
      type: 'github',
      label: 'GitHub',
      logoUrl: '',
      color: '',
      icon: '',
    },
  },
  {
    id: 'ds-3',
    name: 'PagerDuty Services',
    enabled: true,
    logoUrl: '',
    integration: {
      type: 'pagerduty',
      label: 'PagerDuty',
      logoUrl: '',
      color: '',
      icon: '',
    },
  },
] as DataSourceItem[];

describe('DataSourceFacetFilter', () => {
  it('groups data sources by integration', async () => {
    const user = userEvent.setup();
    render(
      <DataSourceFacetFilter
        dataSources={dataSources}
        value={[]}
        onChange={() => {}}
      />,
    );
    await user.click(screen.getByTestId('datasource-facet-filter'));

    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('PagerDuty')).toBeInTheDocument();
    expect(screen.getByText('GitHub Users')).toBeInTheDocument();
    expect(screen.getByText('GitHub Repos')).toBeInTheDocument();
  });

  it('selects an individual data source', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DataSourceFacetFilter
        dataSources={dataSources}
        value={[]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByTestId('datasource-facet-filter'));
    await user.click(screen.getByText('PagerDuty Services'));

    expect(onChange).toHaveBeenCalledWith(['ds-3']);
  });

  it('offers an explicit option to select all data sources', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DataSourceFacetFilter
        dataSources={dataSources}
        value={['ds-1']}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByTestId('datasource-facet-filter'));
    await user.click(screen.getByText('All data sources'));

    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('selects a whole integration group at once', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DataSourceFacetFilter
        dataSources={dataSources}
        value={[]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByTestId('datasource-facet-filter'));
    await user.click(screen.getByText('GitHub'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect([...onChange.mock.calls[0][0]].sort()).toEqual(['ds-1', 'ds-2']);
  });

  it('shows a count badge for the current selection', () => {
    render(
      <DataSourceFacetFilter
        dataSources={dataSources}
        value={['ds-1', 'ds-3']}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('omits the Context Groups group unless rules are provided', async () => {
    const user = userEvent.setup();
    render(
      <DataSourceFacetFilter
        dataSources={dataSources}
        value={[]}
        onChange={() => {}}
      />,
    );
    await user.click(screen.getByTestId('datasource-facet-filter'));

    expect(screen.queryByText('Context Groups')).not.toBeInTheDocument();
  });

  it('selects a single context-group rule', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DataSourceFacetFilter
        dataSources={dataSources}
        contextGroupRules={[
          { id: 'rule-1', name: 'People' },
          { id: 'rule-2', name: 'Services' },
        ]}
        value={[]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByTestId('datasource-facet-filter'));
    await user.click(screen.getByText('People'));

    expect(onChange).toHaveBeenCalledWith(['cg:rule-1']);
  });

  it('selects every context-group rule from the group heading', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DataSourceFacetFilter
        dataSources={dataSources}
        contextGroupRules={[
          { id: 'rule-1', name: 'People' },
          { id: 'rule-2', name: 'Services' },
        ]}
        value={[]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByTestId('datasource-facet-filter'));
    await user.click(screen.getByText('Context Groups'));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect([...onChange.mock.calls[0][0]].sort()).toEqual([
      'cg:rule-1',
      'cg:rule-2',
    ]);
  });
});
