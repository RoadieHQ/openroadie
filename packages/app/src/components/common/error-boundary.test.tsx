import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { RouteErrorBoundary } from './error-boundary';

describe('RouteErrorBoundary', () => {
  it('retries the current route with a client-side replacement navigation', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          id: 'broken-route',
          path: '/',
          loader: () => {
            throw new Error('Route failed');
          },
          Component: () => null,
          ErrorBoundary: RouteErrorBoundary,
        },
      ],
      { initialEntries: ['/'] },
    );
    const navigate = vi.spyOn(router, 'navigate');

    render(<RouterProvider router={router} />);

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(navigate).toHaveBeenCalledWith(
      '.',
      expect.objectContaining({
        fromRouteId: 'broken-route',
        replace: true,
      }),
    );
  });

  it('renders useful details for a missing route resource', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          loader: () => {
            throw new Response('Action not found', { status: 404 });
          },
          Component: () => null,
          ErrorBoundary: RouteErrorBoundary,
        },
      ],
      { initialEntries: ['/'] },
    );

    render(<RouterProvider router={router} />);

    expect(
      await screen.findByRole('heading', { name: 'Not found' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Action not found')).toBeInTheDocument();
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument();
  });
});
