import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MultiCombobox } from './multi-combobox';
import type { ComboboxOption } from './combobox';

const options: ComboboxOption[] = [
  { value: '111111111111', label: 'Production (111111111111)' },
  { value: '222222222222', label: 'Staging (222222222222)' },
  { value: '333333333333', label: 'Dev (333333333333)' },
];

function Controlled({
  initial = [],
  allowCustomValues = false,
  customValueSplitPattern,
  onChange,
  renderChipLabel,
  disabled,
}: {
  initial?: string[];
  allowCustomValues?: boolean;
  customValueSplitPattern?: RegExp;
  onChange?: (values: string[]) => void;
  renderChipLabel?: (value: string) => React.ReactNode;
  disabled?: boolean;
}) {
  const [values, setValues] = React.useState<string[]>(initial);
  return (
    <MultiCombobox
      values={values}
      onChange={next => {
        setValues(next);
        onChange?.(next);
      }}
      options={options}
      placeholder="Pick an account"
      allowCustomValues={allowCustomValues}
      customValueSplitPattern={customValueSplitPattern}
      renderChipLabel={renderChipLabel}
      disabled={disabled}
    />
  );
}

describe('MultiCombobox', () => {
  it('renders chips for the initial values using option labels by default', () => {
    render(<Controlled initial={['111111111111']} />);
    expect(screen.getByText('Production (111111111111)')).toBeInTheDocument();
  });

  it('renders chips using a custom renderChipLabel when provided', () => {
    render(
      <Controlled
        initial={['111111111111']}
        renderChipLabel={value => `Account ${value}`}
      />,
    );
    expect(screen.getByText('Account 111111111111')).toBeInTheDocument();
  });

  it('appends an option when the user clicks it in the dropdown', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: /Staging/ }));

    expect(onChange).toHaveBeenLastCalledWith(['222222222222']);
    expect(screen.getByText('Staging (222222222222)')).toBeInTheDocument();
  });

  it('appends a custom value on Enter when allowCustomValues is true', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled allowCustomValues onChange={onChange} />);

    const input = screen.getByRole('combobox');
    await user.type(input, '999999999999{Enter}');

    expect(onChange).toHaveBeenLastCalledWith(['999999999999']);
    expect(input).toHaveValue('');
  });

  it('creates a chip when a custom value is followed by a separator', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        allowCustomValues
        customValueSplitPattern={/[\s,]+/}
        onChange={onChange}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.type(input, '999999999999 ');

    expect(onChange).toHaveBeenLastCalledWith(['999999999999']);
    expect(input).toHaveValue('');
  });

  it('splits multiple custom values from comma and space separated text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        allowCustomValues
        customValueSplitPattern={/[\s,]+/}
        onChange={onChange}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.type(input, '999999999999,888888888888 ');

    expect(onChange).toHaveBeenLastCalledWith(['999999999999', '888888888888']);
    expect(input).toHaveValue('');
  });

  it('does not append free text when allowCustomValues is false', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);

    await user.type(screen.getByRole('combobox'), '999999999999{Enter}');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes the last chip when Backspace is pressed on empty input', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        initial={['111111111111', '222222222222']}
        onChange={onChange}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{Backspace}');

    expect(onChange).toHaveBeenLastCalledWith(['111111111111']);
  });

  it('does not remove a chip when Backspace is pressed with typed text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        allowCustomValues
        initial={['111111111111']}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByRole('combobox'), 'abc');
    await user.keyboard('{Backspace}');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a chip when its × button is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Controlled initial={['111111111111']} onChange={onChange} />);

    await user.click(
      screen.getByRole('button', { name: 'Remove 111111111111' }),
    );

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('does not append duplicate values', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled
        allowCustomValues
        initial={['111111111111']}
        onChange={onChange}
      />,
    );

    await user.type(screen.getByRole('combobox'), '111111111111{Enter}');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('filters already-selected options out of the dropdown', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={['111111111111']} />);

    await user.click(screen.getByRole('combobox'));

    expect(
      screen.queryByRole('option', { name: /Production/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Staging/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Dev/ })).toBeInTheDocument();
  });

  it('disables typing and chip removal when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled disabled initial={['111111111111']} onChange={onChange} />,
    );

    const input = screen.getByRole('combobox');
    expect(input).toBeDisabled();

    const remove = screen.getByRole('button', { name: 'Remove 111111111111' });
    expect(remove).toBeDisabled();

    await user.click(remove);
    expect(onChange).not.toHaveBeenCalled();
  });
});
