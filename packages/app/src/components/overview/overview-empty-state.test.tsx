import { render, screen } from '@testing-library/react';
import { Zap } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { OverviewEmptyState } from './overview-empty-state';

describe('OverviewEmptyState', () => {
  it('renders title, description, action and the floating icon circle', () => {
    const { container } = render(
      <OverviewEmptyState
        icon={Zap}
        title="No actions yet"
        description="Create your first action to get started"
        action={<Button>New Action</Button>}
      />,
    );

    expect(screen.getByText('No actions yet')).toBeInTheDocument();
    expect(
      screen.getByText('Create your first action to get started'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'New Action' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.size-16')).not.toBeNull();
  });
});
