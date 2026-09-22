import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@roadiehq/ui/tooltip';
import { FlatmapBuilder } from './flatmap-builder';

const render = (ui: React.ReactElement) =>
  rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

const SAMPLE = [
  {
    id: 1,
    name: 'octo',
    _additionalData: { repos: [{ name: 'a' }, { name: 'b' }] },
  },
  { id: 2, name: 'hubot', _additionalData: { repos: [] } },
];

describe('FlatmapBuilder', () => {
  it('offers the array-valued fields of the previous step as options', async () => {
    const user = userEvent.setup();
    render(
      <FlatmapBuilder config={{}} inputSample={SAMPLE} onChange={vi.fn()} />,
    );

    await user.click(screen.getByRole('combobox'));

    expect(
      screen.getByRole('option', { name: /_additionalData\.repos/ }),
    ).toBeInTheDocument();
    // Scalars can't be expanded, and `$` would expand an item into itself.
    expect(screen.queryByRole('option', { name: /^name/ })).toBeNull();
    expect(screen.queryByRole('option', { name: '$' })).toBeNull();
  });

  it('keeps listing an array field two items happen to share', async () => {
    const user = userEvent.setup();
    render(
      <FlatmapBuilder
        config={{}}
        inputSample={[
          { id: 1, tags: [] },
          { id: 2, tags: [] },
        ]}
        onChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByRole('option', { name: /tags/ })).toBeInTheDocument();
  });

  it('reports the picked field as the expression', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FlatmapBuilder config={{}} inputSample={SAMPLE} onChange={onChange} />,
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(
      screen.getByRole('option', { name: /_additionalData\.repos/ }),
    );

    expect(onChange).toHaveBeenCalledWith(
      'expression',
      '$._additionalData.repos',
    );
  });

  it('toggles includeParent', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FlatmapBuilder
        config={{ expression: 'repos' }}
        inputSample={SAMPLE}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByRole('switch'));

    expect(onChange).toHaveBeenCalledWith('includeParent', true);
  });

  it('reflects an already-enabled includeParent', () => {
    render(
      <FlatmapBuilder
        config={{ expression: 'repos', includeParent: true }}
        inputSample={SAMPLE}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('points at the dry run when there is no sample to pick fields from', () => {
    render(<FlatmapBuilder config={{}} onChange={vi.fn()} />);

    expect(screen.getByText(/Dry run the data source/)).toBeInTheDocument();
  });
});
