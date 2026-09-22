import React from 'react';
import { render, screen } from '@testing-library/react';

import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders title, description, icon, and children', () => {
    render(
      <EmptyState
        title="No items found"
        description="Create an item to get started."
        icon={<span data-testid="icon">Icon</span>}
      >
        <button>Action</button>
      </EmptyState>,
    );
    expect(screen.getByText('No items found')).toBeInTheDocument();
    expect(
      screen.getByText('Create an item to get started.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
  });
});
