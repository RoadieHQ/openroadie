import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from './sheet';

describe('Sheet', () => {
  it('opens when trigger is clicked', async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent>
          <SheetTitle>Title</SheetTitle>
          <SheetDescription>Description</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.queryByText('Title')).not.toBeInTheDocument();
    await user.click(screen.getByText('Open'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
  });

  it('renders in controlled open state with the default right side', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Title</SheetTitle>
          <SheetDescription>Content</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('data-side', 'right');
  });

  it('provides the matching field background for nested floating fields', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Title</SheetTitle>
          <SheetDescription>Details</SheetDescription>
        </SheetContent>
      </Sheet>,
    );

    expect(screen.getByRole('dialog')).toHaveClass(
      '[--field-bg:var(--color-surface)]',
    );
  });

  it('reflects the chosen side via data-side', () => {
    render(
      <Sheet open>
        <SheetContent side="left">
          <SheetTitle>Title</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('data-side', 'left');
  });

  it('renders the scrim overlay by default and omits it when hideOverlay is set', () => {
    const { rerender } = render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Title</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(document.querySelector('.motion-radix-overlay')).toBeInTheDocument();

    rerender(
      <Sheet open>
        <SheetContent hideOverlay>
          <SheetTitle>Title</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(
      document.querySelector('.motion-radix-overlay'),
    ).not.toBeInTheDocument();
  });

  it('renders a close button by default and hides it when asked', () => {
    const { rerender } = render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Title</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByText('Close')).toBeInTheDocument();

    rerender(
      <Sheet open>
        <SheetContent hideCloseButton>
          <SheetTitle>Title</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.queryByText('Close')).not.toBeInTheDocument();
  });
});
