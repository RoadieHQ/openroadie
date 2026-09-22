import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestQueryProvider } from '../../../test-utils';
import { DatasourceFilterEditor } from './datasource-filter-editor';

const mockDatastore = {
  getContextGroupFieldProfiles: vi.fn(),
};
vi.mock('../../../api', () => ({
  useDatastore: () => mockDatastore,
}));

function fieldProfile(path: string) {
  return {
    path,
    valueType: 'string',
    container: 'scalar',
    isIdentifierLike: false,
    looksEnumLike: false,
    rowCoverage: 1,
    cardinalityRatio: 1,
  };
}

/** The editor is controlled by its serialized `filter` prop; this harness
 *  feeds edits back in like the datasource entry row does. */
function Harness({
  initial,
  datasourceId = 'ds-1',
  onChange,
}: {
  initial?: string;
  datasourceId?: string;
  onChange: (filter: string | undefined) => void;
}) {
  const [filter, setFilter] = useState<string | undefined>(initial);
  return (
    <DatasourceFilterEditor
      datasourceId={datasourceId}
      datasourceName="DS1"
      filter={filter}
      onChange={next => {
        setFilter(next);
        onChange(next);
      }}
    />
  );
}

function renderEditor(props: Parameters<typeof Harness>[0]) {
  return render(<Harness {...props} />, { wrapper: TestQueryProvider });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDatastore.getContextGroupFieldProfiles.mockResolvedValue({
    datasourceId: 'ds-1',
    fields: [fieldProfile('email'), fieldProfile('enabled')],
    presets: { identifiers: [], essentials: [] },
  });
});

describe('DatasourceFilterEditor', () => {
  it('builds a condition from field, operator, and value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor({ onChange });

    await user.click(
      screen.getByRole('button', { name: 'Add filter for DS1' }),
    );

    await user.click(
      screen.getByRole('combobox', { name: 'Filter 1 field for DS1' }),
    );
    await user.click(await screen.findByRole('option', { name: 'email' }));

    await user.click(
      screen.getByRole('combobox', { name: 'Filter 1 operator for DS1' }),
    );
    await user.click(await screen.findByRole('option', { name: 'ends with' }));

    await user.type(
      screen.getByLabelText('Filter 1 value for DS1'),
      'roadie.io',
    );

    expect(onChange).toHaveBeenLastCalledWith(
      JSON.stringify([
        { field: 'email', operator: 'ends_with', value: 'roadie.io' },
      ]),
    );
  });

  it('renders saved conditions and keeps a field selectable when it is no longer profiled', async () => {
    const user = userEvent.setup();
    renderEditor({
      initial: JSON.stringify([
        { field: 'legacy.path', operator: 'equals', value: 'x' },
      ]),
      onChange: vi.fn(),
    });

    expect(screen.getByLabelText('Filter 1 value for DS1')).toHaveValue('x');

    await user.click(
      screen.getByRole('combobox', { name: 'Filter 1 field for DS1' }),
    );
    expect(
      await screen.findByRole('option', { name: 'legacy.path' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'email' })).toBeInTheDocument();
  });

  it('clears the filter when the last condition is removed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderEditor({
      initial: JSON.stringify([
        { field: 'enabled', operator: 'equals', value: 'false' },
      ]),
      onChange,
    });

    await user.click(
      screen.getByRole('button', { name: 'Remove filter 1 for DS1' }),
    );

    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(
      screen.queryByLabelText('Filter 1 value for DS1'),
    ).not.toBeInTheDocument();
  });

  it('disables adding filters until a datasource is picked', () => {
    renderEditor({ datasourceId: '', onChange: vi.fn() });

    expect(
      screen.getByRole('button', { name: 'Add filter for DS1' }),
    ).toBeDisabled();
  });
});
