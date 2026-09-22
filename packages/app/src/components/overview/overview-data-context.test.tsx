import React from 'react';
import { render, screen, act } from '@testing-library/react';
import {
  OverviewDataProvider,
  usePublishOverviewData,
  useOverviewGroups,
} from './overview-data-context';
import type { OverviewGroupsSnapshot } from './overview-config';

function makeSnapshot(routeKey: string): OverviewGroupsSnapshot {
  return {
    routeKey,
    activeGroup: 'all',
    groups: [
      { key: 'all', label: 'All', count: 2 },
      { key: 'github', label: 'GitHub', count: 2 },
    ],
  };
}

function Publisher({ snapshot }: { snapshot: OverviewGroupsSnapshot | null }) {
  usePublishOverviewData(snapshot);
  return null;
}

function Reader({ routeKey }: { routeKey: string }) {
  const groups = useOverviewGroups(routeKey);
  return (
    <div data-testid={`reader-${routeKey}`}>
      {groups ? groups.groups.map(g => g.label).join(',') : 'none'}
    </div>
  );
}

describe('overview-data-context', () => {
  it('reader sees groups for a matching routeKey', () => {
    render(
      <OverviewDataProvider>
        <Publisher snapshot={makeSnapshot('/data-sources')} />
        <Reader routeKey="/data-sources" />
      </OverviewDataProvider>,
    );
    expect(screen.getByTestId('reader-/data-sources')).toHaveTextContent(
      'All,GitHub',
    );
  });

  it('reader sees null for a non-matching routeKey', () => {
    render(
      <OverviewDataProvider>
        <Publisher snapshot={makeSnapshot('/data-sources')} />
        <Reader routeKey="/integrations" />
      </OverviewDataProvider>,
    );
    expect(screen.getByTestId('reader-/integrations')).toHaveTextContent(
      'none',
    );
  });

  it('retains the published snapshot after the publisher unmounts (cached counts)', () => {
    function Harness({ showPublisher }: { showPublisher: boolean }) {
      return (
        <OverviewDataProvider>
          {showPublisher ? (
            <Publisher snapshot={makeSnapshot('/data-sources')} />
          ) : null}
          <Reader routeKey="/data-sources" />
        </OverviewDataProvider>
      );
    }

    const { rerender } = render(<Harness showPublisher />);
    expect(screen.getByTestId('reader-/data-sources')).toHaveTextContent(
      'All,GitHub',
    );

    // On navigate-away the counts are retained (not cleared) so the sidebar
    // keeps showing the cached categories instantly on return.
    rerender(<Harness showPublisher={false} />);
    expect(screen.getByTestId('reader-/data-sources')).toHaveTextContent(
      'All,GitHub',
    );
  });

  it('does not re-publish (loop) when a new-but-equal snapshot object is passed', () => {
    const renderSpy = vi.fn();

    function CountingPublisher() {
      renderSpy();
      // A fresh object identity on every render, but structurally equal.
      usePublishOverviewData(makeSnapshot('/data-sources'));
      return null;
    }

    render(
      <OverviewDataProvider>
        <CountingPublisher />
        <Reader routeKey="/data-sources" />
      </OverviewDataProvider>,
    );

    // Publishing sets provider state once → at most one extra render pass.
    // If the effect looped, renderSpy would be called many more times.
    expect(renderSpy.mock.calls.length).toBeLessThanOrEqual(3);
    expect(screen.getByTestId('reader-/data-sources')).toHaveTextContent(
      'All,GitHub',
    );
  });

  it('is a no-op without a provider (does not throw)', () => {
    expect(() =>
      render(<Publisher snapshot={makeSnapshot('/data-sources')} />),
    ).not.toThrow();
  });

  it('updates when the published snapshot content changes', () => {
    function Harness({ routeKey }: { routeKey: string }) {
      return (
        <OverviewDataProvider>
          <Publisher snapshot={makeSnapshot(routeKey)} />
          <Reader routeKey="/integrations" />
        </OverviewDataProvider>
      );
    }

    const { rerender } = render(<Harness routeKey="/data-sources" />);
    expect(screen.getByTestId('reader-/integrations')).toHaveTextContent(
      'none',
    );

    act(() => {
      rerender(<Harness routeKey="/integrations" />);
    });
    expect(screen.getByTestId('reader-/integrations')).toHaveTextContent(
      'All,GitHub',
    );
  });
});
