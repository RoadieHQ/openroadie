import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { DrawerPanelHeader } from './resizable-drawer-header';
import { DrawerStack, type DrawerStackView } from './drawer-stack';

describe('DrawerPanelHeader', () => {
  it('renders titleNode outside the expand toggle so it can hold its own buttons', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onCrumb = vi.fn();

    render(
      <DrawerPanelHeader
        titleNode={
          <button type="button" onClick={onCrumb}>
            Suggestions
          </button>
        }
        expanded
        onToggleExpanded={onToggle}
        toggleDisabled={false}
        collapsedTitle="Expand"
        expandedTitle="Collapse"
        standaloneTitle=""
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Suggestions' }));

    expect(onCrumb).toHaveBeenCalledTimes(1);
    // The crumb must not be nested inside the expand toggle, which would
    // fire both handlers from one click.
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('still renders a plain title inside the expand toggle', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <DrawerPanelHeader
        title="Suggestions"
        countLabel="(95 total)"
        expanded
        onToggleExpanded={onToggle}
        toggleDisabled={false}
        collapsedTitle="Expand"
        expandedTitle="Collapse"
        standaloneTitle=""
      />,
    );

    await user.click(screen.getByRole('button', { name: /Suggestions/ }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByText('(95 total)')).toBeInTheDocument();
  });
});

function view(
  id: string,
  label: string,
  overrides: Partial<DrawerStackView> = {},
): DrawerStackView {
  return {
    id,
    label,
    render: () => <div data-testid={`content-${id}`}>{label} content</div>,
    ...overrides,
  };
}

/** A view whose body owns state, so a remount is observable. */
function statefulView(id: string, label: string): DrawerStackView {
  return {
    id,
    label,
    render: () => <StatefulBody id={id} />,
  };
}

function StatefulBody({ id }: { id: string }) {
  const [value, setValue] = useState('');
  return (
    <input
      data-testid={`input-${id}`}
      value={value}
      onChange={e => setValue(e.target.value)}
    />
  );
}

function renderStack(
  views: DrawerStackView[],
  overrides: Partial<React.ComponentProps<typeof DrawerStack>> = {},
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  // jsdom reports clientHeight 0 for plain divs; the drawer needs a non-zero
  // container height to leave peek mode and render the body (same fix as
  // relationship-rule-inspector.test.tsx).
  Object.defineProperty(container, 'clientHeight', {
    configurable: true,
    value: 800,
  });
  const props = {
    open: true,
    container,
    views,
    onNavigate: vi.fn(),
    onClose: vi.fn(),
    label: 'suggestions drawer',
    ...overrides,
  };
  render(
    <MemoryRouter>
      <DrawerStack {...props} />
    </MemoryRouter>,
  );
  return props;
}

describe('DrawerStack', () => {
  it('renders only the active view, which is the last in the path', () => {
    renderStack([view('list', 'Suggestions'), view('review', 'Review rule')]);

    expect(screen.getByTestId('content-review')).toBeVisible();
    expect(screen.getByTestId('content-list')).not.toBeVisible();
  });

  it('renders no breadcrumb for a single view', () => {
    renderStack([view('list', 'Suggestions')]);

    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('renders ancestors as buttons and the active crumb as current, not a button', () => {
    renderStack([view('list', 'Suggestions'), view('review', 'Review rule')]);

    expect(
      screen.getByRole('button', { name: 'Suggestions' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Review rule' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Review rule')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('navigates to an ancestor when its crumb is clicked', async () => {
    const user = userEvent.setup();
    const props = renderStack([
      view('list', 'Suggestions'),
      view('review', 'Review rule'),
    ]);

    await user.click(screen.getByRole('button', { name: 'Suggestions' }));

    expect(props.onNavigate).toHaveBeenCalledWith('list');
  });

  it('closes when the close button is clicked', async () => {
    const user = userEvent.setup();
    const props = renderStack([view('list', 'Suggestions')]);

    await user.click(screen.getByRole('button', { name: 'Close drawer' }));

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps exactly one resize handle however deep the path is', () => {
    renderStack([view('list', 'Suggestions')]);
    expect(screen.getAllByRole('slider')).toHaveLength(1);
    cleanup();

    renderStack([view('list', 'Suggestions'), view('review', 'Review rule')]);
    expect(screen.getAllByRole('slider')).toHaveLength(1);
  });

  it('lets the active view intercept leaving via onBeforeLeave', async () => {
    const user = userEvent.setup();
    const proceedSpy = vi.fn();
    const props = renderStack([
      view('list', 'Suggestions'),
      view('review', 'Review rule', {
        onBeforeLeave: proceed => {
          proceedSpy(proceed);
        },
      }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Suggestions' }));

    // Intercepted: the stack must not navigate until proceed() runs.
    expect(props.onNavigate).not.toHaveBeenCalled();
    expect(proceedSpy).toHaveBeenCalledTimes(1);

    proceedSpy.mock.calls[0][0]();
    expect(props.onNavigate).toHaveBeenCalledWith('list');
  });

  it('runs the guard of every view a breadcrumb jump unmounts, deepest first', async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const guard = (id: string) => (proceed: () => void) => {
      order.push(id);
      proceed();
    };
    const props = renderStack([
      view('list', 'Suggestions'),
      view('review', 'Review rule', { onBeforeLeave: guard('review') }),
      view('detail', 'Match detail', { onBeforeLeave: guard('detail') }),
    ]);

    await user.click(screen.getByRole('button', { name: 'Suggestions' }));

    expect(order).toEqual(['detail', 'review']);
    expect(props.onNavigate).toHaveBeenCalledWith('list');
  });

  it('lets a skipped intermediate view abandon the exit', async () => {
    const user = userEvent.setup();
    const props = renderStack([
      view('list', 'Suggestions'),
      view('review', 'Review rule', {
        onBeforeLeave: () => {
          // Never proceeds — the jump must be abandoned.
        },
      }),
      view('detail', 'Match detail'),
    ]);

    await user.click(screen.getByRole('button', { name: 'Suggestions' }));

    expect(props.onNavigate).not.toHaveBeenCalled();
  });

  it('routes close through ancestor guards too, not just the active view', async () => {
    const user = userEvent.setup();
    const proceedSpy = vi.fn();
    const props = renderStack([
      view('list', 'Suggestions', {
        onBeforeLeave: proceed => proceedSpy(proceed),
      }),
      view('review', 'Review rule'),
    ]);

    await user.click(screen.getByRole('button', { name: 'Close drawer' }));

    expect(props.onClose).not.toHaveBeenCalled();
    proceedSpy.mock.calls[0][0]();
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('exposes the panel as a named region landmark', () => {
    render(
      <MemoryRouter>
        <DrawerStack
          open
          label="Suggestions"
          container={document.body}
          views={[view('list', 'Suggestions')]}
          onNavigate={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('region', { name: 'Suggestions' }),
    ).toBeInTheDocument();
  });

  it('renders nothing without a container to portal into', () => {
    render(
      <MemoryRouter>
        <DrawerStack
          open
          container={null}
          views={[view('list', 'Suggestions')]}
          onNavigate={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('content-list')).not.toBeInTheDocument();
  });

  it('keeps an ancestor view mounted but hidden while a deeper view is active', () => {
    renderStack([view('list', 'Suggestions'), view('review', 'Review rule')]);

    const ancestor = screen.getByTestId('content-list');
    expect(ancestor).toBeInTheDocument();
    expect(ancestor).not.toBeVisible();
    expect(screen.getByTestId('content-review')).toBeVisible();
  });

  it('preserves an ancestor view’s state across a round trip', async () => {
    const user = userEvent.setup();
    const list = statefulView('list', 'Suggestions');
    const review = view('review', 'Review rule');
    const container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(container, 'clientHeight', { value: 800 });

    const props = {
      open: true,
      container,
      onNavigate: vi.fn(),
      onClose: vi.fn(),
      label: 'suggestions drawer',
    };
    const { rerender } = render(
      <MemoryRouter>
        <DrawerStack {...props} views={[list]} />
      </MemoryRouter>,
    );

    // The reviewer filters the list, then opens one suggestion.
    await user.type(screen.getByTestId('input-list'), 'kubernetes');
    rerender(
      <MemoryRouter>
        <DrawerStack {...props} views={[list, review]} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('content-review')).toBeVisible();

    // Back via the breadcrumb: their filter must still be there.
    rerender(
      <MemoryRouter>
        <DrawerStack {...props} views={[list]} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('input-list')).toHaveValue('kubernetes');
  });

  it('unmounts a view that leaves the path, discarding its state', async () => {
    const user = userEvent.setup();
    const list = view('list', 'Suggestions');
    const review = statefulView('review', 'Review rule');
    const container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(container, 'clientHeight', { value: 800 });

    const props = {
      open: true,
      container,
      onNavigate: vi.fn(),
      onClose: vi.fn(),
      label: 'suggestions drawer',
    };
    const { rerender } = render(
      <MemoryRouter>
        <DrawerStack {...props} views={[list, review]} />
      </MemoryRouter>,
    );

    await user.type(screen.getByTestId('input-review'), 'edited');
    rerender(
      <MemoryRouter>
        <DrawerStack {...props} views={[list]} />
      </MemoryRouter>,
    );

    // Leaving the path must discard the editor's unsaved buffer, not park it.
    expect(screen.queryByTestId('input-review')).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <DrawerStack {...props} views={[list, review]} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('input-review')).toHaveValue('');
  });

  it('keeps the active view mounted when the drawer is collapsed', async () => {
    const user = userEvent.setup();
    const container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(container, 'clientHeight', { value: 800 });

    render(
      <MemoryRouter>
        <DrawerStack
          open
          container={container}
          views={[statefulView('list', 'Suggestions')]}
          onNavigate={vi.fn()}
          onClose={vi.fn()}
          label="suggestions drawer"
        />
      </MemoryRouter>,
    );

    await user.type(screen.getByTestId('input-list'), 'kubernetes');

    // Clicking the resize handle cycles the height; from mid it collapses to peek.
    await user.click(screen.getByRole('slider'));
    await user.click(screen.getByRole('slider'));

    // Collapsing hides the body; it must not throw the reviewer's work away.
    expect(screen.getByTestId('input-list')).toHaveValue('kubernetes');
  });
});
