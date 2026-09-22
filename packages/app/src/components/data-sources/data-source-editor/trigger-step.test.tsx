import React from 'react';
import { act, waitFor } from '@testing-library/react';
import { renderWithQuery as render } from '../../../test-utils';

import { MemoryRouter } from 'react-router';
import { TriggerStep } from './trigger-step';
import {
  DataSourceEditorContext,
  type DataSourceEditorContextValue,
} from './data-source-editor-context';

vi.mock('humanize-duration', () => ({
  default: () => '2 hours',
}));

const mockWorkflowApi = {
  workflows: {
    getScheduleInfo: vi.fn().mockResolvedValue({ nextRunAt: null }),
  },
  integrations: { list: vi.fn().mockResolvedValue({ data: [], total: 0 }) },
} as unknown as DataSourceEditorContextValue['workflowApi'];

function makeContext(
  overrides?: Partial<DataSourceEditorContextValue>,
): DataSourceEditorContextValue {
  return {
    triggerType: null as unknown as DataSourceEditorContextValue['triggerType'],
    setTriggerType: vi.fn(),
    triggerConfig: {},
    setTriggerConfig: vi.fn(),
    sourceType: null as unknown as DataSourceEditorContextValue['sourceType'],
    setSourceType: vi.fn(),
    sourceConfig: {},
    setSourceConfig: vi.fn(),
    transforms: [],
    setTransforms: vi.fn(),
    sinks: [],
    setSinks: vi.fn(),
    selectedSteps: [],
    setSelectedSteps: vi.fn(),
    expandedStep: null,
    setExpandedStep: vi.fn(),
    nodeOutputs: {},
    setNodeOutputs: vi.fn(),
    nodeErrors: {},
    setNodeErrors: vi.fn(),
    runningNodes: new Set<string>(),
    setRunningNodes: vi.fn(),
    searchQuery: '',
    setSearchQuery: vi.fn(),
    isSourceConfigured: false,
    sourceOutput: undefined,
    finalOutput: undefined,
    previewLoading: false,
    previewError: null,
    isPreviewRun: false,
    confirmedSinkSchema: {},
    setConfirmedSinkSchema: vi.fn(),
    workflowApi: mockWorkflowApi,
    handleAddTrigger: vi.fn(),
    handleTriggerConfigChange: vi.fn(),
    markChanged: vi.fn(),
    handleSourceConfigChange: vi.fn(),
    handleAddTransform: vi.fn(),
    handleAddChainedSource: vi.fn(),
    handleUpdateTransform: vi.fn(),
    handleDeleteTransform: vi.fn(),
    handleUpdateSink: vi.fn(),
    handleDeleteSink: vi.fn(),
    handleRun: vi.fn(),
    sourceSchemaVersion: 0,
    bumpSourceSchemaVersion: vi.fn(),
    accumulatedSchema: null,
    setAccumulatedSchema: vi.fn(),
    workflowId: 'ds-1',
    isEnabled: false,
    secretRefreshNonce: 0,
    bumpSecretRefresh: vi.fn(),
    scheduleRefreshNonce: 0,
    allStepIds: ['trigger', 'source'],
    handleStepClick: vi.fn(),
    ...overrides,
    // Spreading a Partial relaxes required fields; the fixture only sets what
    // the step under test reads.
  } as DataSourceEditorContextValue;
}

function renderWithContext(overrides?: Partial<DataSourceEditorContextValue>) {
  return render(
    <MemoryRouter>
      <DataSourceEditorContext.Provider value={makeContext(overrides)}>
        <TriggerStep />
      </DataSourceEditorContext.Provider>
    </MemoryRouter>,
  );
}

describe('TriggerStep', () => {
  it('fetches the next run time once on mount and does not poll', async () => {
    const getScheduleInfo = vi
      .fn()
      .mockResolvedValue({ nextRunAt: '2026-01-01T00:00:00Z' });
    const api = {
      workflows: { getScheduleInfo },
      integrations: { list: vi.fn().mockResolvedValue({ data: [], total: 0 }) },
    } as unknown as DataSourceEditorContextValue['workflowApi'];

    renderWithContext({
      triggerType: 'schedule',
      isEnabled: true,
      workflowApi: api,
    });

    await waitFor(() => expect(getScheduleInfo).toHaveBeenCalledTimes(1));
    expect(getScheduleInfo).toHaveBeenCalledWith('ds-1');

    // Flush the resolved fetch's state update before the test ends, so it
    // can't land outside act() on a slow machine.
    await act(async () => {});
  });

  it('re-fetches and briefly polls when a save bumps scheduleRefreshNonce', async () => {
    vi.useFakeTimers();
    try {
      const getScheduleInfo = vi.fn().mockResolvedValue({ nextRunAt: null });
      const api = {
        workflows: { getScheduleInfo },
        integrations: {
          list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
        },
      } as unknown as DataSourceEditorContextValue['workflowApi'];

      const ui = (nonce: number) => (
        <MemoryRouter>
          <DataSourceEditorContext.Provider
            value={makeContext({
              triggerType: 'schedule',
              isEnabled: true,
              workflowApi: api,
              scheduleRefreshNonce: nonce,
            })}
          >
            <TriggerStep />
          </DataSourceEditorContext.Provider>
        </MemoryRouter>
      );

      const { rerender } = render(ui(0));
      // Timer callbacks update React state, so advance inside act().
      await act(() => vi.advanceTimersByTimeAsync(0));
      // Initial mount fetches once and does not poll.
      expect(getScheduleInfo).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(8000));
      expect(getScheduleInfo).toHaveBeenCalledTimes(1);

      // A save bumps the nonce: immediate fetch + three polled retries.
      rerender(ui(1));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(getScheduleInfo).toHaveBeenCalledTimes(2);
      await act(() => vi.advanceTimersByTimeAsync(7000));
      expect(getScheduleInfo).toHaveBeenCalledTimes(5);
    } finally {
      vi.useRealTimers();
    }
  });
});
