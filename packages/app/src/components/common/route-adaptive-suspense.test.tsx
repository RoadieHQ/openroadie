import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { RouteAdaptiveLoadingView } from './route-adaptive-suspense';

// The fallback is gated behind useDelayedFlag so a fast chunk load shows
// nothing; advance past its delay to see what a slow load would render.
const DELAY_MS = 200;

function renderFallbackAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <RouteAdaptiveLoadingView />
    </MemoryRouter>,
  );
  act(() => {
    vi.advanceTimersByTime(DELAY_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RouteAdaptiveLoadingView', () => {
  it('renders the table skeleton for the datastore objects route', () => {
    renderFallbackAt('/datastore?ds=ds-1');

    // Same skeleton the page itself shows once its chunk lands, rather than the
    // generic centered blocks (loading-states rule #3).
    const table = document.querySelector('table');
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll('thead th')).toHaveLength(5);
  });

  it('adds the Data source column when the scope spans data sources', () => {
    renderFallbackAt('/datastore');

    expect(document.querySelectorAll('thead th')).toHaveLength(6);
  });

  it('honours a legacy dataSourceId deep link', () => {
    renderFallbackAt('/datastore?dataSourceId=ds-1');

    expect(document.querySelectorAll('thead th')).toHaveLength(5);
  });

  it('falls back to the generic skeleton for a non-listing route', () => {
    renderFallbackAt('/datastore/ds-1/obj-1');

    expect(document.querySelector('table')).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
