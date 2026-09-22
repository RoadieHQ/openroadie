import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FieldColumn } from './field-column';
import type { SchemaField } from './schema-field-utils';

const baseProps = {
  heading: 'Field',
  accessibleLabel: 'Source field',
  value: '',
  onChange: () => {},
};

describe('FieldColumn', () => {
  it('opens in Expression mode when the datasource has no schema fields', async () => {
    const user = userEvent.setup();
    render(<FieldColumn {...baseProps} fields={[]} />);

    // No fields to pick, so the control must land on the expression input rather
    // than an empty field autocomplete the author has to escape from.
    expect(
      screen.getByPlaceholderText('e.g. $.spec.owner'),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Select a field')).toBeNull();

    // Field mode is unavailable, so clicking it must not switch away from the
    // expression input.
    await user.click(screen.getByRole('radio', { name: 'Field' }));
    expect(
      screen.getByPlaceholderText('e.g. $.spec.owner'),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Select a field')).toBeNull();
  });

  it('opens in Field mode when schema fields are available', () => {
    const fields: SchemaField[] = [{ name: 'owner', type: 'string' }];
    render(<FieldColumn {...baseProps} fields={fields} />);

    expect(screen.getByPlaceholderText('Select a field')).toBeInTheDocument();
  });
});
