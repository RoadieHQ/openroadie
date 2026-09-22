import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PickerCombobox } from './picker-combobox';
import type { PickerComboboxGroup } from './picker-combobox';

const GROUPS: PickerComboboxGroup[] = [
  {
    options: [
      { id: 'a', label: 'Apple' },
      { id: 'b', label: 'Banana' },
      { id: 'c', label: 'Cherry' },
    ],
  },
];

const MULTI_GROUPS: PickerComboboxGroup[] = [
  {
    label: 'Citrus',
    id: 'type-citrus',
    checked: false,
    options: [
      { id: 'lemon', label: 'Lemon' },
      { id: 'lime', label: 'Lime' },
    ],
  },
  {
    label: 'Berries',
    id: 'type-berries',
    checked: false,
    options: [{ id: 'strawberry', label: 'Strawberry' }],
  },
];

function optionByLabel(label: string) {
  const match = screen
    .getAllByRole('option')
    .find(option => option.textContent === label);
  if (!match) {
    throw new Error(`No option with label "${label}"`);
  }
  return match;
}

describe('PickerCombobox', () => {
  it('reflects selection (not keyboard focus) via aria-selected', async () => {
    const user = userEvent.setup();
    render(
      <PickerCombobox
        groups={GROUPS}
        selectedId="b"
        onSelect={vi.fn()}
        ariaLabel="Fruit"
      />,
    );

    await user.click(screen.getByRole('combobox'));

    expect(optionByLabel('Banana')).toHaveAttribute('aria-selected', 'true');
    expect(optionByLabel('Apple')).toHaveAttribute('aria-selected', 'false');
    expect(optionByLabel('Cherry')).toHaveAttribute('aria-selected', 'false');

    // Moving the keyboard focus must not change which option is "selected".
    await user.keyboard('{ArrowDown}');

    expect(optionByLabel('Cherry')).toHaveAttribute('data-focused', 'true');
    expect(optionByLabel('Cherry')).toHaveAttribute('aria-selected', 'false');
    expect(optionByLabel('Banana')).toHaveAttribute('aria-selected', 'true');
  });

  it('selects an option on click without the blur timer dropping it', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <PickerCombobox groups={GROUPS} onSelect={onSelect} ariaLabel="Fruit" />,
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Cherry' }));

    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('falls back to a generic aria-label when neither label nor ariaLabel is set', () => {
    render(<PickerCombobox groups={GROUPS} onSelect={vi.fn()} />);

    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-label',
      'Search',
    );
  });

  it('uses the floating label as the accessible name when a label is set', () => {
    render(
      <PickerCombobox groups={GROUPS} onSelect={vi.fn()} label="Integration" />,
    );

    const input = screen.getByRole('combobox');
    expect(input).not.toHaveAttribute('aria-label');
    expect(screen.getByLabelText('Integration')).toBe(input);
  });

  it('toggles selectable group headings via keyboard in multi mode', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <PickerCombobox
        groups={MULTI_GROUPS}
        multiple
        selectedIds={[]}
        onSelect={vi.fn()}
        onToggle={onToggle}
        triggerEmptyLabel="Types"
      />,
    );

    await user.click(screen.getByRole('button', { name: /types/i }));
    await user.click(screen.getByRole('textbox', { name: 'Filter' }));
    await user.keyboard('{Enter}');

    expect(onToggle).toHaveBeenCalledWith('type-citrus');
  });

  it('clears the filter query when the multi-select popover closes', async () => {
    const user = userEvent.setup();
    render(
      <PickerCombobox
        groups={MULTI_GROUPS}
        multiple
        selectedIds={[]}
        onSelect={vi.fn()}
        onToggle={vi.fn()}
        triggerEmptyLabel="Types"
      />,
    );

    await user.click(screen.getByRole('button', { name: /types/i }));
    const filter = screen.getByRole('textbox', { name: 'Filter' });
    await user.type(filter, 'lem');
    expect(filter).toHaveValue('lem');

    await user.click(screen.getByRole('button', { name: /types/i }));
    await user.click(screen.getByRole('button', { name: /types/i }));

    expect(screen.getByRole('textbox', { name: 'Filter' })).toHaveValue('');
    expect(screen.getByRole('option', { name: /lemon/i })).toBeInTheDocument();
  });
});
