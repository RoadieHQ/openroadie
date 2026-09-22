import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionInspectorDrawer } from './execution-inspector-drawer';

const mockRetry = vi.fn();
const mockUseExecution = vi.fn();

vi.mock('../use-execution', () => ({
  useExecution: (...args: unknown[]) => mockUseExecution(...args),
  ExecutionSubscription: () => null,
}));

vi.mock('./execution-monitor', () => ({
  ExecutionMonitor: () => <div data-testid="execution-monitor" />,
}));

vi.mock('@roadiehq/ui/resizable-drawer', () => ({
  DrawerResizeHandle: () => <div data-testid="resize-handle" />,
  DrawerPanelHeader: ({
    title,
    countLabel,
    actions,
  }: {
    title: React.ReactNode;
    countLabel: string;
    actions: React.ReactNode;
  }) => (
    <div>
      <div>{title}</div>
      <div>{countLabel}</div>
      <div>{actions}</div>
    </div>
  ),
  useResizableDrawerPanel: () => ({
    panelHeight: '320px',
    isCollapsed: false,
    cyclePanelHeight: vi.fn(),
    resizeHandleProps: {},
  }),
}));

function mockExecutionState() {
  mockUseExecution.mockReturnValue({
    execution: {
      workflowSnapshot: {
        name: 'Test execution',
        nodes: [],
      },
    },
    nodeExecutions: new Map(),
    logs: [],
    requestLogs: [],
    status: 'running',
    progress: {
      completed: 0,
      total: 1,
      percentage: 0,
    },
    loading: false,
    error: undefined,
    isRunning: true,
    isFailed: false,
    cancel: vi.fn(),
    cancelling: false,
    retry: mockRetry,
  });
}

function renderDrawer(props?: {
  onRefreshExecutions?: () => void;
  container?: HTMLElement;
}) {
  const container = props?.container ?? document.createElement('div');
  document.body.appendChild(container);

  return render(
    <ExecutionInspectorDrawer
      open
      container={container}
      executionId="exec-1"
      onClose={vi.fn()}
      onRefreshExecutions={props?.onRefreshExecutions}
    />,
  );
}

describe('ExecutionInspectorDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecutionState();
  });

  it('refreshes the current execution and execution list when clicked', () => {
    const onRefreshExecutions = vi.fn();

    renderDrawer({ onRefreshExecutions });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh execution' }));

    expect(mockRetry).toHaveBeenCalledTimes(1);
    expect(onRefreshExecutions).toHaveBeenCalledTimes(1);
  });

  it('renders the refresh button without an execution list refresh callback', () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh execution' }));

    expect(mockRetry).toHaveBeenCalledTimes(1);
  });
});
