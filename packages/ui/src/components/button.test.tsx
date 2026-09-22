import React from 'react';
import { render, screen } from '@testing-library/react';

import { Button } from './button';

describe('Button', () => {
  it('renders with default variant', () => {
    render(<Button>Click me</Button>);
    expect(
      screen.getByRole('button', { name: 'Click me' }),
    ).toBeInTheDocument();
  });

  it('applies variant classes', () => {
    const { container } = render(<Button variant="destructive">Delete</Button>);
    expect(container.firstChild).toHaveClass('bg-destructive');
  });

  it('applies sidebar variant with null size like main branch shell row', () => {
    const { container } = render(
      <Button variant="sidebar" size={null}>
        Nav
      </Button>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el).toHaveClass('justify-start');
    expect(el).toHaveClass('[&_svg]:size-[18px]');
    expect(el).not.toHaveClass('h-9');
  });

  it('applies size classes', () => {
    const { container } = render(<Button size="sm">Small</Button>);
    expect(container.firstChild).toHaveClass('h-8');
  });

  it('renders as child element when asChild is true', () => {
    render(
      <Button asChild>
        <a href="/test">Link Button</a>
      </Button>,
    );
    expect(
      screen.getByRole('link', { name: 'Link Button' }),
    ).toBeInTheDocument();
  });

  it('forwards ref', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Button</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });

  it('passes through HTML attributes', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  describe('loading state', () => {
    it('disables the button while loading', () => {
      render(<Button loading>Save</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });

    it('exposes data-loading attribute only while loading', () => {
      const { rerender } = render(<Button loading>Save</Button>);
      expect(screen.getByRole('button')).toHaveAttribute(
        'data-loading',
        'true',
      );

      rerender(<Button loading={false}>Save</Button>);
      expect(screen.getByRole('button')).not.toHaveAttribute('data-loading');
    });

    it('shows loadingText in place of string children when loading', () => {
      render(
        <Button loading loadingText="Saving...">
          <svg data-testid="icon" />
          Save
        </Button>,
      );
      const button = screen.getByRole('button');
      expect(button).toHaveTextContent('Saving...');
      // icon stays outside the text overlay, so it only renders once.
      expect(screen.getAllByTestId('icon')).toHaveLength(1);
    });

    it('reserves width for the loading label even when not loading', () => {
      render(
        <Button loadingText="Saving...">
          <svg data-testid="icon" />
          Save
        </Button>,
      );
      const button = screen.getByRole('button');
      // Both labels live in the DOM (one visible, one hidden ghost) so the
      // resting width already accommodates the loading label.
      expect(button.textContent).toContain('Save');
      expect(button.textContent).toContain('Saving...');
      // Icon renders once — it sits outside the text overlay.
      expect(screen.getAllByTestId('icon')).toHaveLength(1);
    });

    it('hides the ghost label from assistive tech', () => {
      const { container } = render(
        <Button loadingText="Saving...">Save</Button>,
      );
      const ghost = container.querySelector('[aria-hidden="true"]');
      expect(ghost).not.toBeNull();
      expect(ghost).toHaveTextContent('Saving...');
    });

    it('does not wrap children in a ghost when loadingText is omitted', () => {
      const { container } = render(<Button loading>Save</Button>);
      expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    });
  });
});
