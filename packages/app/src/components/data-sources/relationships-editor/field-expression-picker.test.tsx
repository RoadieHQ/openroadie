import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldExpressionPicker } from './field-expression-picker';
import type { AutocompleteOption } from '@roadiehq/ui/autocomplete';

const options: AutocompleteOption[] = [
  { value: '$.uri', label: 'uri', group: '' },
  { value: '$.images', label: 'images', group: '' },
];

/** The picker is controlled, and the bug only shows when the edited value flows
 * back down — so every typing test drives it through real parent state. */
function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <FieldExpressionPicker
      heading="Field"
      accessibleLabel="Source field"
      value={value}
      onChange={setValue}
      options={options}
    />
  );
}

const expressionInput = () => screen.getByPlaceholderText('e.g. $.spec.owner');

describe('FieldExpressionPicker', () => {
  it('keeps focus in the expression input while an accessor path is typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('radio', { name: 'Expression' }));
    await user.type(expressionInput(), '.images');

    // A half-typed path crosses the plain/advanced boundary on nearly every
    // keystroke ('.' can't be parsed, '.i' can) — the mode must not follow it.
    expect(expressionInput()).toHaveValue('.images');
    expect(expressionInput()).toHaveFocus();
    expect(screen.queryByPlaceholderText('Select a field')).toBeNull();
  });

  it('keeps focus in the expression input while an expression is deleted', async () => {
    const user = userEvent.setup();
    render(<Harness initial="$.images[*].name" />);

    // An advanced value opens in Expression mode without any manual toggle.
    await user.click(expressionInput());
    await user.keyboard('{Backspace>8/}');

    expect(expressionInput()).toHaveValue('$.images');
    expect(expressionInput()).toHaveFocus();
    expect(screen.queryByPlaceholderText('Select a field')).toBeNull();
  });

  it('switches to Expression when the value becomes one the picker cannot show', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <FieldExpressionPicker
        heading="Field"
        accessibleLabel="Source field"
        value="$.uri"
        onChange={() => {}}
        options={options}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'Field' }));
    expect(screen.getByPlaceholderText('Select a field')).toBeInTheDocument();

    rerender(
      <FieldExpressionPicker
        heading="Field"
        accessibleLabel="Source field"
        value="$.images[*].name"
        onChange={() => {}}
        options={options}
      />,
    );

    // Field mode can't represent a wildcard, so the toggle must not keep
    // claiming Field.
    expect(expressionInput()).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Select a field')).toBeNull();
  });
});
