import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Autocomplete, type AutocompleteOption } from './autocomplete';

const options: AutocompleteOption[] = [
  {
    value: '$.spec.owner',
    label: 'owner',
    description: 'spec.owner',
  },
  {
    value: '$.metadata.name',
    label: 'name',
    description: 'metadata.name',
  },
];

function leaf(value: string) {
  return value.split('.').at(-1) ?? value;
}

function ControlledAutocomplete() {
  const [value, setValue] = React.useState('$.spec.owner');

  return (
    <Autocomplete
      aria-label="Field"
      value={value}
      onChange={setValue}
      options={options}
      displayValue={leaf}
    />
  );
}

describe('Autocomplete', () => {
  it('edits the stored value rather than the display value', () => {
    render(<ControlledAutocomplete />);

    const input = screen.getByRole('combobox', { name: 'Field' });
    expect(input).toHaveValue('owner');

    fireEvent.focus(input);
    expect(input).toHaveValue('$.spec.owner');

    fireEvent.change(input, { target: { value: '$.spec.ownerId' } });
    expect(input).toHaveValue('$.spec.ownerId');

    fireEvent.blur(input);
    expect(input).toHaveValue('ownerId');
  });

  it('keeps option selection writing canonical option values', async () => {
    const user = userEvent.setup();
    render(<ControlledAutocomplete />);

    const input = screen.getByRole('combobox', { name: 'Field' });
    await user.click(input);
    await user.click(screen.getByRole('option', { name: 'name' }));

    expect(input).toHaveValue('$.metadata.name');
    fireEvent.blur(input);
    expect(input).toHaveValue('name');
  });
});
