import { render, screen } from '@testing-library/react';
import { Box, Database } from 'lucide-react';
import { GhostGraphPreview } from './ghost-graph-preview';

describe('GhostGraphPreview', () => {
  it('renders a decorative graph preview', () => {
    const { container } = render(
      <GhostGraphPreview
        nodes={[
          {
            id: 'source',
            label: 'Orders',
            detail: 'Data source',
            icon: Database,
            x: 25,
            y: 50,
          },
          {
            id: 'object',
            label: 'Order #1042',
            detail: 'Object',
            icon: Box,
            x: 75,
            y: 50,
          },
        ]}
        edges={[{ source: 'source', target: 'object' }]}
      />,
    );

    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('Order #1042')).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector('line')).not.toBeNull();
  });
});
