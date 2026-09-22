import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DirectRelationshipBadge } from './direct-relationship-badge';

describe('DirectRelationshipBadge', () => {
  it('renders the label', () => {
    render(<DirectRelationshipBadge />);
    expect(screen.getByText('Direct relationship')).toBeInTheDocument();
  });

  it('explains the concept in a tooltip on hover', async () => {
    const user = userEvent.setup();
    render(<DirectRelationshipBadge />);

    await user.hover(screen.getByText('Direct relationship'));

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent(/created by hand/i);
    expect(tooltip).toHaveTextContent(
      /not materialized by a relationship rule/i,
    );
  });
});
