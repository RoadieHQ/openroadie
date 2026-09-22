import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import {
  WorkflowGraphNode,
  type WorkflowGraphNodeData,
} from './workflow-graph-node';

const { mockUpdateNodeInternals, mockUseEdges } = vi.hoisted(() => ({
  mockUpdateNodeInternals: vi.fn(),
  mockUseEdges: vi.fn((): Edge[] => []),
}));

vi.mock('@xyflow/react', () => ({
  Handle: ({ id }: { id?: string }) => (
    <div data-testid={id ? `handle-${id}` : 'handle'} />
  ),
  useUpdateNodeInternals: () => mockUpdateNodeInternals,
  useEdges: () => mockUseEdges(),
  NodeResizeControl: ({
    onResize,
    onResizeEnd,
  }: {
    onResize?: (
      event: React.PointerEvent<HTMLDivElement>,
      params: {
        x: number;
        y: number;
        width: number;
        height: number;
        direction: number[];
      },
    ) => void;
    onResizeEnd?: (
      event: React.PointerEvent<HTMLDivElement>,
      params: { x: number; y: number; width: number; height: number },
    ) => void;
  }) => (
    <div
      aria-label="Resize data source node"
      role="separator"
      onPointerDown={event => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={event => {
        onResize?.(event, {
          x: 0,
          y: 0,
          width: 360,
          height: 48,
          direction: [1, 0],
        });
      }}
      onPointerUp={event => {
        onResizeEnd?.(event, {
          x: 0,
          y: 0,
          width: 360,
          height: 48,
        });
      }}
    />
  ),
  NodeToolbar: ({
    isVisible,
    children,
  }: {
    isVisible?: boolean;
    children?: React.ReactNode;
  }) => (isVisible === false ? null : <div>{children}</div>),
  Position: {
    Left: 'left',
    Right: 'right',
    Top: 'top',
    Bottom: 'bottom',
  },
  ResizeControlVariant: {
    Line: 'line',
    Handle: 'handle',
  },
}));

function ResizableWorkflowGraphNode() {
  const [width, setWidth] = useState(220);
  const data: WorkflowGraphNodeData = {
    label: 'GitHub repositories',
    hasSchema: true,
    schemaFields: [{ name: 'repositoryName', type: 'string' }],
    width,
    onWidthChange: (_nodeId, nextWidth) => setWidth(nextWidth),
  };

  return (
    <WorkflowGraphNode
      id="workflow-github"
      type="workflowGraphNode"
      data={data}
      selected={false}
      dragging={false}
      zIndex={0}
      selectable
      deletable
      draggable
      isConnectable
      positionAbsoluteX={0}
      positionAbsoluteY={0}
    />
  );
}

const nodeProps = {
  type: 'workflowGraphNode',
  selected: false,
  dragging: false,
  zIndex: 0,
  selectable: true,
  deletable: true,
  draggable: true,
  isConnectable: true,
  positionAbsoluteX: 0,
  positionAbsoluteY: 0,
} as const;

describe('WorkflowGraphNode', () => {
  beforeEach(() => {
    mockUpdateNodeInternals.mockClear();
    mockUseEdges.mockReturnValue([]);
  });

  it('widens when the right resize control is dragged', () => {
    render(<ResizableWorkflowGraphNode />);

    expect(screen.getByTestId('workflow-graph-node')).toHaveStyle({
      width: '220px',
    });

    const resizeControl = screen.getByRole('separator', {
      name: 'Resize data source node',
    });
    fireEvent.pointerDown(resizeControl, { pointerId: 1, clientX: 220 });
    fireEvent.pointerMove(resizeControl, { pointerId: 1, clientX: 360 });
    fireEvent.pointerUp(resizeControl, { pointerId: 1, clientX: 360 });

    expect(screen.getByTestId('workflow-graph-node')).toHaveStyle({
      width: '360px',
    });
  });

  it('remeasures when a saved rule adds field handles after mount', () => {
    const data: WorkflowGraphNodeData = {
      label: 'GitHub repositories',
      hasSchema: true,
      schemaFields: [{ name: 'repositoryName', type: 'string' }],
    };

    const { rerender } = render(
      <WorkflowGraphNode id="workflow-github" data={data} {...nodeProps} />,
    );

    mockUpdateNodeInternals.mockClear();
    mockUseEdges.mockReturnValue([
      {
        id: 'rule-1',
        source: 'workflow-github',
        target: 'workflow-other',
        sourceHandle: 'right-field-repositoryName#rule-1',
        data: { edgeColor: '#6366f1' },
      },
    ]);

    rerender(
      <WorkflowGraphNode
        id="workflow-github"
        data={data}
        {...nodeProps}
        selected
      />,
    );

    expect(
      screen.getByTestId('handle-right-field-repositoryName#rule-1'),
    ).toBeInTheDocument();
    expect(mockUpdateNodeInternals).toHaveBeenCalledWith('workflow-github');
  });
});
