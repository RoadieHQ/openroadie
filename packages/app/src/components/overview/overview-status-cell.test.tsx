import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OverviewStatusCell } from './overview-status-cell';

describe('OverviewStatusCell', () => {
  it('keeps a healthy label for assistive tech only (dot is the visual signal)', () => {
    render(<OverviewStatusCell tone="success" label="Enabled" />);
    // The label stays in the DOM (a11y + tooltip) but is visually hidden.
    const label = screen.getByText('Enabled');
    expect(label).toHaveClass('sr-only');
  });

  it('keeps the label visually hidden by default even for attention tones', () => {
    // Overviews read as a dot; the reason lives in the tooltip.
    render(<OverviewStatusCell tone="warning" label="Needs setup" />);
    expect(screen.getByText('Needs setup')).toHaveClass('sr-only');
  });

  it('shows the label inline when expanded (the drawer variant)', () => {
    render(<OverviewStatusCell tone="warning" label="Needs setup" expanded />);
    expect(screen.getByText('Needs setup')).not.toHaveClass('sr-only');
  });

  it('becomes a button and invokes onClick when interactive', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <OverviewStatusCell
        tone="warning"
        label="Needs setup"
        onClick={onClick}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Needs setup/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
