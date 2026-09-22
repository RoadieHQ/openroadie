import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { DetailDrawer } from './detail-drawer';

function renderDrawer(
  props: Partial<React.ComponentProps<typeof DetailDrawer>> = {},
) {
  return render(
    <MemoryRouter>
      <DetailDrawer
        open
        onOpenChange={vi.fn()}
        title="Example entity"
        {...props}
      >
        <p>Drawer body</p>
      </DetailDrawer>
    </MemoryRouter>,
  );
}

describe('DetailDrawer', () => {
  it('runs the standard editor action when editing is handled in place', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderDrawer({
      editAction: { type: 'callback', onSelect: onEdit },
    });

    await user.click(screen.getByRole('button', { name: 'Open editor' }));

    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('renders the routed editor action as a link', () => {
    renderDrawer({
      editAction: { type: 'link', href: '/entities/example' },
    });

    expect(screen.getByRole('link', { name: 'Open editor' })).toHaveAttribute(
      'href',
      '/entities/example',
    );
  });

  it('shows a meaningful error state instead of the drawer body', () => {
    renderDrawer({ error: 'The entity could not be loaded' });

    expect(screen.getByText("Couldn't load details")).toBeInTheDocument();
    expect(
      screen.getByText('The entity could not be loaded'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Drawer body')).not.toBeInTheDocument();
  });

  // Non-modal dismissal: clicking another overview row must swap the drawer's
  // contents (handled by the row's own click handler) rather than close it, so
  // the drawer suppresses Radix's auto-close for clicks that land on a row.
  describe('non-modal dismissal', () => {
    it('stays open when an overview row is clicked', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      render(
        <MemoryRouter>
          <div data-row-id="row-2">Another row</div>
          <DetailDrawer open onOpenChange={onOpenChange} title="Example entity">
            <p>Drawer body</p>
          </DetailDrawer>
        </MemoryRouter>,
      );

      await user.click(screen.getByText('Another row'));

      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it('closes when a non-row element outside the drawer is clicked', async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      render(
        <MemoryRouter>
          <div>Elsewhere</div>
          <DetailDrawer open onOpenChange={onOpenChange} title="Example entity">
            <p>Drawer body</p>
          </DetailDrawer>
        </MemoryRouter>,
      );

      await user.click(screen.getByText('Elsewhere'));

      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    });
  });

  // The body has four states (error → delayed skeleton → pre-delay nothing →
  // children). Anti-flicker means a fast load shows neither a skeleton nor a
  // half-rendered body; see loading-states.md rule #6.
  describe('loading', () => {
    it('renders neither the body nor a skeleton before the loading delay', () => {
      renderDrawer({ loading: true, loadingView: <p>Loading details…</p> });

      expect(screen.queryByText('Drawer body')).not.toBeInTheDocument();
      expect(screen.queryByText('Loading details…')).not.toBeInTheDocument();
    });

    it('shows the custom loading view while loading, then the body once loaded', async () => {
      const { rerender } = renderDrawer({
        loading: true,
        loadingView: <p>Loading details…</p>,
      });

      await waitFor(() =>
        expect(screen.getByText('Loading details…')).toBeInTheDocument(),
      );
      expect(screen.queryByText('Drawer body')).not.toBeInTheDocument();

      rerender(
        <MemoryRouter>
          <DetailDrawer
            open
            onOpenChange={vi.fn()}
            title="Example entity"
            loading={false}
            loadingView={<p>Loading details…</p>}
          >
            <p>Drawer body</p>
          </DetailDrawer>
        </MemoryRouter>,
      );

      await waitFor(() =>
        expect(screen.getByText('Drawer body')).toBeInTheDocument(),
      );
      expect(screen.queryByText('Loading details…')).not.toBeInTheDocument();
    });
  });
});
