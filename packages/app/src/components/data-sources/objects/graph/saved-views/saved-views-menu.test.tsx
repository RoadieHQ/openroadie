// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SavedGraphView } from './saved-view-schema';
import { SavedViewsMenu } from './saved-views-menu';

const VIEW: SavedGraphView = {
  id: 'view-1',
  name: 'Payments blast radius',
  createdAt: '2026-07-28T00:00:00.000Z',
  params: { view: 'object', focus: 'ds-1:x' },
  camera: null,
};

describe('SavedViewsMenu', () => {
  const onApply = vi.fn();
  const onSaveCurrent = vi.fn();
  const onDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderMenu(views: SavedGraphView[] = [VIEW]) {
    return render(
      <SavedViewsMenu
        views={views}
        onApply={onApply}
        onSaveCurrent={onSaveCurrent}
        onDelete={onDelete}
      />,
    );
  }

  it('applies a view on click', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByTestId('saved-views-trigger'));
    await user.click(
      screen.getByRole('menuitem', { name: /Payments blast radius/ }),
    );

    expect(onApply).toHaveBeenCalledWith(VIEW);
  });

  it('saves the current view through the naming dialog', async () => {
    const user = userEvent.setup();
    renderMenu([]);

    await user.click(screen.getByTestId('saved-views-trigger'));
    await user.click(
      screen.getByRole('menuitem', { name: /Save current view/ }),
    );
    await user.type(screen.getByLabelText(/View name/), 'New exploration');
    await user.click(screen.getByRole('button', { name: 'Save view' }));

    await waitFor(() => {
      expect(onSaveCurrent).toHaveBeenCalledWith('New exploration');
    });
  });

  it('rejects an empty or duplicate name as a field error', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByTestId('saved-views-trigger'));
    await user.click(
      screen.getByRole('menuitem', { name: /Save current view/ }),
    );

    await user.click(screen.getByRole('button', { name: 'Save view' }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/View name/),
      'Payments blast radius',
    );
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    expect(
      await screen.findByText('A view with this name already exists'),
    ).toBeInTheDocument();
    expect(onSaveCurrent).not.toHaveBeenCalled();
  });

  it('deletes only after confirmation, without applying', async () => {
    const user = userEvent.setup();
    renderMenu();

    await user.click(screen.getByTestId('saved-views-trigger'));
    await user.click(
      screen.getByRole('button', {
        name: 'Delete saved view Payments blast radius',
      }),
    );
    expect(onDelete).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete view' }));
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('view-1');
    });
    expect(onApply).not.toHaveBeenCalled();
  });
});
