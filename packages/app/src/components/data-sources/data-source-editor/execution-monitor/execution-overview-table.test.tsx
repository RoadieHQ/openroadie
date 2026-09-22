/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  NodeExecutionState,
  WorkflowNode,
} from '../../../../api/workflow/workflow-client';
import { ExecutionOverviewTable } from './execution-overview-table';

const SINK_ERROR =
  'Index expression "$.sha" produced duplicate values: 348b8666, 482723ca. Prefer a compound unique index (JSONata), e.g. $string(_parent.id) & "-" & $string($.id).';

const nodes: WorkflowNode[] = [
  {
    id: 'sink-1',
    type: 'datastore-sink',
    position: { x: 0, y: 0 },
    data: { label: 'Datastore', config: {} },
  },
];

const failedSink = new Map<string, NodeExecutionState>([
  ['sink-1', { nodeId: 'sink-1', status: 'failed', error: SINK_ERROR }],
]);

describe('ExecutionOverviewTable', () => {
  it('summarises a failed node instead of dumping the raw error', () => {
    render(
      <ExecutionOverviewTable nodes={nodes} nodeExecutions={failedSink} />,
    );

    expect(
      screen.getByText('Duplicate object IDs — the ID selector is not unique'),
    ).toBeInTheDocument();
  });

  it('reveals the full error, which is too long to truncate usefully', async () => {
    const user = userEvent.setup();
    render(
      <ExecutionOverviewTable nodes={nodes} nodeExecutions={failedSink} />,
    );

    expect(screen.queryByText(SINK_ERROR)).not.toBeInTheDocument();
    await user.click(screen.getByText('Show details'));

    expect(screen.getByText(SINK_ERROR)).toBeInTheDocument();
  });

  it('keeps retry and edit reachable next to the error', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onEdit = vi.fn();
    render(
      <ExecutionOverviewTable
        nodes={nodes}
        nodeExecutions={failedSink}
        onRetry={onRetry}
        onEdit={onEdit}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(onRetry).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('shows a busy Retry while a re-run is being scheduled and blocks re-clicks', () => {
    const onRetry = vi.fn();
    render(
      <ExecutionOverviewTable
        nodes={nodes}
        nodeExecutions={failedSink}
        onRetry={onRetry}
        retrying
      />,
    );

    const retry = screen.getByRole('button', { name: 'Retrying…' });
    expect(retry).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  it('renders no error row for a healthy node', () => {
    render(
      <ExecutionOverviewTable
        nodes={nodes}
        nodeExecutions={
          new Map([
            ['sink-1', { nodeId: 'sink-1', status: 'completed', itemCount: 4 }],
          ])
        }
      />,
    );

    expect(screen.queryByText('Show details')).not.toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
