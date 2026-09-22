import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { GraphViewport, type GraphViewportHandle } from './graph-viewport';

const BOUNDS = { x: -100, y: -100, width: 200, height: 200 };

function renderViewport(
  props: Partial<React.ComponentProps<typeof GraphViewport>> = {},
) {
  const handleRef = createRef<GraphViewportHandle>();
  const view = render(
    <GraphViewport
      contentBounds={BOUNDS}
      handleRef={handleRef}
      ariaLabel="Test graph"
      data-testid="viewport"
      {...props}
    >
      <circle data-testid="world-node" r={10} />
    </GraphViewport>,
  );
  return { handleRef, view, container: screen.getByTestId('viewport') };
}

describe('GraphViewport', () => {
  beforeEach(() => {
    // Snap all camera animations so assertions are synchronous.
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('prefers-reduced-motion'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          onchange: null,
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders world content inside a transformed group', () => {
    renderViewport();
    const node = screen.getByTestId('world-node');
    const group = node.closest('g[transform]');
    expect(group).not.toBeNull();
  });

  it('zooms on wheel toward the cursor', () => {
    const { handleRef, container } = renderViewport();
    const before = handleRef.current!.getCamera();

    fireEvent.wheel(container, { deltaY: -200, clientX: 50, clientY: 50 });

    const after = handleRef.current!.getCamera();
    expect(after.k).toBeGreaterThan(before.k);
  });

  it('pans on drag and suppresses the click the drag would produce', () => {
    const onWorldClick = vi.fn();
    const handleRef = createRef<GraphViewportHandle>();
    render(
      <GraphViewport
        contentBounds={BOUNDS}
        handleRef={handleRef}
        ariaLabel="Test graph"
        data-testid="viewport"
      >
        <circle data-testid="world-node" r={10} onClick={onWorldClick} />
      </GraphViewport>,
    );
    const container = screen.getByTestId('viewport');
    const node = screen.getByTestId('world-node');
    const before = handleRef.current!.getCamera();

    fireEvent.pointerDown(node, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(container, { clientX: 40, clientY: 10 });
    fireEvent.pointerUp(container, { clientX: 40, clientY: 10 });
    fireEvent.click(node);

    const after = handleRef.current!.getCamera();
    expect(after.x - before.x).toBeCloseTo(30);
    expect(onWorldClick).not.toHaveBeenCalled();
  });

  it('keeps clicks that stay within the drag slop', () => {
    const onWorldClick = vi.fn();
    render(
      <GraphViewport
        contentBounds={BOUNDS}
        ariaLabel="Test graph"
        data-testid="viewport"
      >
        <circle data-testid="world-node" r={10} onClick={onWorldClick} />
      </GraphViewport>,
    );
    const container = screen.getByTestId('viewport');
    const node = screen.getByTestId('world-node');

    fireEvent.pointerDown(node, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(container, { clientX: 12, clientY: 10 });
    fireEvent.pointerUp(container, { clientX: 12, clientY: 10 });
    fireEvent.click(node);

    expect(onWorldClick).toHaveBeenCalledTimes(1);
  });

  it('setCamera snaps the camera and wins over later auto-fits', () => {
    const { handleRef, view } = renderViewport();
    handleRef.current!.setCamera({ x: 123, y: 45, k: 2 });
    expect(handleRef.current!.getCamera()).toEqual({ x: 123, y: 45, k: 2 });

    // A content change would refit an untouched camera; a user-owned one
    // must stay put.
    view.rerender(
      <GraphViewport
        contentBounds={{ x: 0, y: 0, width: 500, height: 500 }}
        handleRef={handleRef}
        ariaLabel="Test graph"
        data-testid="viewport"
      >
        <circle data-testid="world-node" r={10} />
      </GraphViewport>,
    );
    expect(handleRef.current!.getCamera()).toEqual({ x: 123, y: 45, k: 2 });
  });

  it('applies a restored initial camera as user-owned', () => {
    const { handleRef } = renderViewport({
      initialCamera: { x: 9, y: 8, k: 0.5 },
    });
    expect(handleRef.current!.getCamera()).toEqual({ x: 9, y: 8, k: 0.5 });
  });

  it('zoom buttons change the zoom and fit restores auto-fit', () => {
    const { handleRef } = renderViewport();
    const start = handleRef.current!.getCamera();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(handleRef.current!.getCamera().k).toBeGreaterThan(start.k);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit graph to view' }));
    // jsdom measures the container as 0×0, so the fit falls back to k=1.
    expect(handleRef.current!.getCamera().k).toBe(1);
  });

  it('notifies camera changes', async () => {
    const onCameraChange = vi.fn();
    const { container } = renderViewport({ onCameraChange });
    fireEvent.wheel(container, { deltaY: -200, clientX: 0, clientY: 0 });
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(onCameraChange).toHaveBeenCalled();
  });
});
