import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';
import { OverviewTitleCell } from './overview-title-cell';

function renderCell(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('OverviewTitleCell', () => {
  it('renders a link to the entity route when given `to`', () => {
    renderCell(
      <OverviewTitleCell to="/capabilities/cap-1">Deploy</OverviewTitleCell>,
    );

    const link = screen.getByRole('link', { name: 'Deploy' });
    expect(link).toHaveAttribute('href', '/capabilities/cap-1');
  });

  it('renders plain text with no link when `to` is omitted', () => {
    renderCell(<OverviewTitleCell>Deploy</OverviewTitleCell>);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Deploy')).toBeInTheDocument();
  });

  it('forwards data-testid in both modes', () => {
    const { unmount } = renderCell(
      <OverviewTitleCell to="/actions/a-1" data-testid="title">
        Run
      </OverviewTitleCell>,
    );
    expect(screen.getByTestId('title').tagName).toBe('A');
    unmount();

    renderCell(<OverviewTitleCell data-testid="title">Run</OverviewTitleCell>);
    expect(screen.getByTestId('title').tagName).toBe('SPAN');
  });

  // The datastore objects table wraps its title in a tooltip, so the cell has
  // to work as an `asChild` trigger: the trigger's props and ref must reach the
  // anchor itself, or the tooltip never opens and keyboard users lose it.
  it('works as an asChild trigger, forwarding props to the anchor', () => {
    renderCell(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <OverviewTitleCell to="/datastore/ds-1/obj-1">
              alice@example.com
            </OverviewTitleCell>
          </TooltipTrigger>
          <TooltipContent>alice@example.com</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    const title = screen.getByRole('link', { name: 'alice@example.com' });
    expect(title).toHaveAttribute('data-state', 'closed');
  });

  it('truncates long titles rather than wrapping', () => {
    renderCell(
      <OverviewTitleCell to="/actions/a-1" data-testid="title">
        A very long entity name that will not fit the column
      </OverviewTitleCell>,
    );

    expect(screen.getByTestId('title')).toHaveClass('truncate');
  });
});
