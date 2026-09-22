import { fireEvent, render, screen, within } from '@testing-library/react';
import { DataSourcePicker } from './data-source-picker';

const dataSources = [
  { id: 'ds-1', name: 'GitHub Repositories', logoUrl: 'https://logo/gh.svg' },
  { id: 'ds-2', name: 'Jira Issues' },
];

describe('DataSourcePicker', () => {
  it('renders the options from props and fires onChange with the picked id', async () => {
    const onChange = vi.fn();
    render(
      <DataSourcePicker
        dataSources={dataSources}
        value=""
        onChange={onChange}
        placeholder="Select a data source"
        ariaLabel="Select a data source"
      />,
    );

    const combobox = screen.getByRole('combobox', {
      name: 'Select a data source',
    });
    fireEvent.focus(combobox);

    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('GitHub Repositories');
    expect(options[1]).toHaveTextContent('Jira Issues');

    fireEvent.mouseDown(screen.getByText('Jira Issues'));
    expect(onChange).toHaveBeenCalledWith('ds-2');
  });

  it('shows the selected data source name and filters options while typing', async () => {
    const onChange = vi.fn();
    render(
      <DataSourcePicker
        dataSources={dataSources}
        value="ds-1"
        onChange={onChange}
      />,
    );

    const combobox = screen.getByRole('combobox');
    expect(combobox).toHaveValue('GitHub Repositories');

    fireEvent.focus(combobox);
    fireEvent.change(combobox, { target: { value: 'jira' } });

    const listbox = await screen.findByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Jira Issues');

    fireEvent.keyDown(combobox, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('ds-2');
  });

  it('confirms with Enter immediately after reopening, focused on the selection', async () => {
    const onChange = vi.fn();
    render(
      <DataSourcePicker
        dataSources={dataSources}
        value="ds-2"
        onChange={onChange}
      />,
    );

    const combobox = screen.getByRole('combobox');
    // open + close once, then reopen without touching arrows or the query
    fireEvent.focus(combobox);
    await screen.findByRole('listbox');
    fireEvent.blur(combobox);
    fireEvent.focus(combobox);
    await screen.findByRole('listbox');

    fireEvent.keyDown(combobox, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('ds-2');
  });
});
