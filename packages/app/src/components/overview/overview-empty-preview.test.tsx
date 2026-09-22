import { render, screen } from '@testing-library/react';
import { Button } from '@roadiehq/ui/button';
import { OverviewEmptyPreview } from './overview-empty-preview';

describe('OverviewEmptyPreview', () => {
  it('renders copy, the ghost preview, and the action', () => {
    const { container } = render(
      <OverviewEmptyPreview
        title="No actions yet"
        description="Reusable, parameterized HTTP operations."
        preview={<div data-testid="ghost-preview" />}
        action={<Button>New Action</Button>}
      />,
    );

    expect(screen.getByText('No actions yet')).toBeInTheDocument();
    expect(
      screen.getByText('Reusable, parameterized HTTP operations.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('ghost-preview')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'New Action' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.size-16')).toBeNull();
  });

  it('omits the action row when no action is given', () => {
    render(
      <OverviewEmptyPreview
        title="No actions yet"
        preview={<div data-testid="ghost-preview" />}
      />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
