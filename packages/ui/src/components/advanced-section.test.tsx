import React from 'react';
import { render, screen } from '@testing-library/react';

import { AdvancedSection } from './advanced-section';

describe('AdvancedSection', () => {
  it('stays controlled when toggled closed', () => {
    const { rerender } = render(
      <AdvancedSection open={false}>
        <div>Advanced content</div>
      </AdvancedSection>,
    );

    expect(screen.queryByText('Advanced content')).not.toBeInTheDocument();

    rerender(
      <AdvancedSection open>
        <div>Advanced content</div>
      </AdvancedSection>,
    );

    expect(screen.getByText('Advanced content')).toBeInTheDocument();

    rerender(
      <AdvancedSection open={false}>
        <div>Advanced content</div>
      </AdvancedSection>,
    );

    expect(screen.queryByText('Advanced content')).not.toBeInTheDocument();
  });

  it('uses the shared trigger focus styling', () => {
    render(
      <AdvancedSection open>
        <div>Advanced content</div>
      </AdvancedSection>,
    );

    expect(screen.getByRole('button', { name: 'Advanced' })).toHaveClass(
      'mx-1',
      'mt-1',
      'outline-none',
      'focus-visible:ring-2',
      'focus-visible:ring-inset',
      'focus-visible:ring-ring',
    );
  });

  it('uses inset content spacing', () => {
    render(
      <AdvancedSection open>
        <div>Advanced content</div>
      </AdvancedSection>,
    );

    expect(screen.getByText('Advanced content').parentElement).toHaveClass(
      'mx-1',
      'px-3',
      'pb-3',
    );
  });

  it('renders embedded variant without an outer border', () => {
    const { container } = render(
      <AdvancedSection open variant="embedded" label="Exclusions & filtering">
        <div>Advanced content</div>
      </AdvancedSection>,
    );

    expect(container.firstChild).not.toHaveClass('border', 'border-divider');
    expect(
      screen.getByRole('button', { name: 'Exclusions & filtering' }),
    ).toHaveClass('bg-transparent', 'px-0');
    expect(screen.getByText('Advanced content').parentElement).not.toHaveClass(
      'mx-1',
    );
  });
});
