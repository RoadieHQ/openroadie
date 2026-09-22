import React, { useRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@roadiehq/ui/button';
import {
  Link,
  RouterProvider,
  createMemoryRouter,
  useLocation,
  useNavigate,
} from 'react-router';
import { describe, expect, it } from 'vitest';
import { UnsavedChangesBlocker } from './unsaved-changes-blocker';

function CurrentPath() {
  return <div data-testid="path">{useLocation().pathname}</div>;
}

function Editor({
  when,
  allowNavigationRef,
}: {
  when: boolean;
  allowNavigationRef?: React.RefObject<boolean>;
}) {
  return (
    <>
      <UnsavedChangesBlocker
        when={when}
        allowNavigationRef={allowNavigationRef}
      />
      <CurrentPath />
      <Link to="/elsewhere">Elsewhere</Link>
    </>
  );
}

function SaveAndLeave() {
  const navigate = useNavigate();
  const allowNavigationRef = useRef(false);

  return (
    <>
      <Editor when allowNavigationRef={allowNavigationRef} />
      <Button
        type="button"
        onClick={() => {
          allowNavigationRef.current = true;
          void navigate('/elsewhere');
        }}
      >
        Save and leave
      </Button>
    </>
  );
}

function renderRouter(when: boolean, editor = <Editor when={when} />) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: editor,
      },
      {
        path: '/elsewhere',
        element: (
          <>
            <CurrentPath />
            <div>Destination</div>
          </>
        ),
      },
    ],
    { initialEntries: ['/'] },
  );

  render(<RouterProvider router={router} />);
}

describe('UnsavedChangesBlocker', () => {
  it('keeps the user on the editor when navigation is cancelled', async () => {
    const user = userEvent.setup();
    renderRouter(true);

    await user.click(screen.getByRole('link', { name: 'Elsewhere' }));

    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
    expect(screen.getByTestId('path')).toHaveTextContent('/');
  });

  it('continues to the requested route after discarding changes', async () => {
    const user = userEvent.setup();
    renderRouter(true);

    await user.click(screen.getByRole('link', { name: 'Elsewhere' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));

    expect(await screen.findByText('Destination')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/elsewhere');
  });

  it('does not interrupt navigation when there are no unsaved changes', async () => {
    const user = userEvent.setup();
    renderRouter(false);

    await user.click(screen.getByRole('link', { name: 'Elsewhere' }));

    expect(await screen.findByText('Destination')).toBeInTheDocument();
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
  });

  it('allows intentional post-mutation navigation', async () => {
    const user = userEvent.setup();
    renderRouter(true, <SaveAndLeave />);

    await user.click(screen.getByRole('button', { name: 'Save and leave' }));

    expect(await screen.findByText('Destination')).toBeInTheDocument();
    expect(screen.queryByText('Discard unsaved changes?')).toBeNull();
  });
});
