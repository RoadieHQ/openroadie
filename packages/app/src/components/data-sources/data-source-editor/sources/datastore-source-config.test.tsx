import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { DatastoreSourceConfig } from './datastore-source-config';
import {
  DataSourceEditorContext,
  type DataSourceEditorContextValue,
} from '../data-source-editor-context';

const mockUseDataSources = vi.fn();

vi.mock('../../use-data-sources', () => ({
  useDataSources: (options?: unknown) => mockUseDataSources(options),
}));

function renderWithContext(
  props: {
    config: Record<string, unknown>;
    onChange: (f: string, v: unknown) => void;
  },
  workflowId?: string,
) {
  return render(
    <DataSourceEditorContext.Provider
      value={{ workflowId } as unknown as DataSourceEditorContextValue}
    >
      <DatastoreSourceConfig {...props} />
    </DataSourceEditorContext.Provider>,
  );
}

describe('DatastoreSourceConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDataSources.mockReturnValue({
      dataSources: [
        { id: 'ds-self', name: 'Current Pipeline', logoUrl: '' },
        {
          id: 'ds-users',
          name: 'GitHub Users',
          logoUrl: 'https://logo/gh.svg',
        },
        { id: 'ds-repos', name: 'GitHub Repos', logoUrl: '' },
      ],
      loading: false,
      error: undefined,
    });
  });

  it('lists other data sources, excludes the current workflow, and round-trips a selection', async () => {
    const onChange = vi.fn();
    renderWithContext({ config: {}, onChange }, 'ds-self');

    const combobox = screen.getByRole('combobox', { name: 'Data source' });
    fireEvent.focus(combobox);

    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('GitHub Users');
    expect(options[1]).toHaveTextContent('GitHub Repos');
    expect(within(listbox).queryByText('Current Pipeline')).toBeNull();

    fireEvent.mouseDown(screen.getByText('GitHub Users'));
    expect(onChange).toHaveBeenCalledWith('datasourceId', 'ds-users');
    expect(onChange).toHaveBeenCalledWith('datasourceName', 'GitHub Users');
  });

  it('shows the persisted selection', () => {
    const onChange = vi.fn();
    renderWithContext(
      {
        config: {
          datasourceId: 'ds-repos',
          datasourceName: 'GitHub Repos',
        },
        onChange,
      },
      'ds-self',
    );

    expect(screen.getByRole('combobox', { name: 'Data source' })).toHaveValue(
      'GitHub Repos',
    );
  });

  it('surfaces a data source load error', () => {
    mockUseDataSources.mockReturnValue({
      dataSources: [],
      loading: false,
      error: new Error('boom'),
    });
    renderWithContext({ config: {}, onChange: vi.fn() }, undefined);

    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Data source' })).toBeNull();
  });
});
