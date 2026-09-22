import { act, waitFor } from '@testing-library/react';
import { renderHookWithQuery } from '../../../test-utils';
import { useActionTestRun } from './use-action-test-run';
import type { ActionParam, ActionStep } from '../types';

const mockExecuteDraft = vi.fn();
vi.mock('../../../api', () => ({
  useActions: () => ({ executeDraft: mockExecuteDraft }),
}));

const STEPS: ActionStep[] = [
  {
    id: 'createIssue',
    integrationId: 'int-1',
    request: {
      method: 'POST',
      path: '/issues',
      headers: [],
      body: '',
    },
  },
];

const NO_PARAMS: [] = [];

const LOADED_PARAMS: ActionParam[] = [
  { name: 'title', type: 'string' },
  { name: 'count', type: 'integer', default: 3 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useActionTestRun', () => {
  it('surfaces a thrown request error on the inputs node', async () => {
    mockExecuteDraft.mockRejectedValue(new Error('network down'));
    const { result } = renderHookWithQuery(() =>
      useActionTestRun({ parameters: NO_PARAMS, steps: STEPS }),
    );

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(result.current.validationError).toBe('network down');
    });
    expect(result.current.result).toBeNull();
    expect(result.current.running).toBe(false);
  });

  it('clears the run result when the definition changes', async () => {
    mockExecuteDraft.mockResolvedValue({
      ok: true,
      status: 200,
      data: {},
      steps: [{ id: 'createIssue', ok: true, status: 200, data: {} }],
    });
    const { result, rerender } = renderHookWithQuery(
      ({ steps }) => useActionTestRun({ parameters: NO_PARAMS, steps }),
      { initialProps: { steps: STEPS } },
    );

    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.result).not.toBeNull();
    });

    const editedSteps: ActionStep[] = [
      { ...STEPS[0], request: { ...STEPS[0].request, path: '/edited' } },
    ];
    rerender({ steps: editedSteps });

    await waitFor(() => {
      expect(result.current.result).toBeNull();
    });
  });

  it('reseeds input text when parameters load after an empty first render', () => {
    const { result, rerender } = renderHookWithQuery(
      ({ parameters }) => useActionTestRun({ parameters, steps: STEPS }),
      { initialProps: { parameters: NO_PARAMS as ActionParam[] } },
    );

    expect(result.current.inputText).toBe('{}');

    rerender({ parameters: LOADED_PARAMS });

    expect(result.current.inputText).toBe(
      JSON.stringify({ title: '', count: 3 }, null, 2),
    );
  });

  it('does not overwrite user-edited inputs when parameters change', () => {
    const { result, rerender } = renderHookWithQuery(
      ({ parameters }) => useActionTestRun({ parameters, steps: STEPS }),
      { initialProps: { parameters: NO_PARAMS as ActionParam[] } },
    );

    act(() => {
      result.current.setInputText('{"title":"custom"}');
    });

    rerender({ parameters: LOADED_PARAMS });

    expect(result.current.inputText).toBe('{"title":"custom"}');
  });
});
