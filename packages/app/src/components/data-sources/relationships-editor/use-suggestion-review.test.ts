import { act, renderHook, waitFor } from '@testing-library/react';
import { TestQueryProvider } from '../../../test-utils';
import { useSuggestionReview } from './use-suggestion-review';

const mockApi = {
  approveRelationshipRule: vi.fn(),
  dismissRelationshipRule: vi.fn(),
};
const mockAlert = { post: vi.fn() };
vi.mock('../../../api', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../api')>();
  return {
    ...actual,
    useDatastore: () => mockApi,
    useAlert: () => mockAlert,
  };
});

const renderReview = () =>
  renderHook(() => useSuggestionReview(), { wrapper: TestQueryProvider });

describe('useSuggestionReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.approveRelationshipRule.mockResolvedValue(undefined);
    mockApi.dismissRelationshipRule.mockResolvedValue(undefined);
  });

  // The backend's /:id/approve route dismisses the mirrored A→B / B→A
  // suggestion itself, so the app must issue no follow-up dismiss: by the time
  // it ran the mirror is already inactive and POST /:id/dismiss (gated on
  // `suggested`) 409s, which toasts a spurious error on every mirrored approve.
  // `rankShown` is the row's displayed position, threaded to the endpoint.
  it('approves the requested rule and issues no other transition', async () => {
    const { result } = renderReview();
    await act(async () => {
      await result.current.approveSuggestion('win', 0);
    });
    expect(mockApi.approveRelationshipRule).toHaveBeenCalledTimes(1);
    expect(mockApi.approveRelationshipRule).toHaveBeenCalledWith('win', {
      rankShown: 0,
    });
    expect(mockApi.dismissRelationshipRule).not.toHaveBeenCalled();
  });

  it('rejects when the approve fails and clears pending', async () => {
    mockApi.approveRelationshipRule.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderReview();
    await expect(
      act(() => result.current.approveSuggestion('win')),
    ).rejects.toThrow();
    expect(mockApi.dismissRelationshipRule).not.toHaveBeenCalled();
    expect(result.current.pendingRuleIds.size).toBe(0);
  });

  it('tracks pending ids while an action is in flight', async () => {
    let release!: () => void;
    mockApi.approveRelationshipRule.mockReturnValueOnce(
      new Promise<void>(res => (release = res)),
    );
    const { result } = renderReview();
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = result.current.approveSuggestion('win');
    });
    await waitFor(() =>
      expect(result.current.pendingRuleIds.has('win')).toBe(true),
    );
    await act(async () => {
      release();
      await done;
    });
    expect(result.current.pendingRuleIds.size).toBe(0);
  });

  it('dismisses via the dismiss endpoint', async () => {
    const { result } = renderReview();
    await act(async () => {
      await result.current.dismissSuggestion('win', 2);
    });
    expect(mockApi.dismissRelationshipRule).toHaveBeenCalledWith('win', {
      rankShown: 2,
    });
    expect(mockApi.approveRelationshipRule).not.toHaveBeenCalled();
  });

  it('calls onAfterMutation after a successful approve', async () => {
    const onAfterMutation = vi.fn();
    const { result } = renderHook(
      () => useSuggestionReview({ onAfterMutation }),
      { wrapper: TestQueryProvider },
    );
    await act(async () => {
      await result.current.approveSuggestion('win');
    });
    expect(onAfterMutation).toHaveBeenCalled();
  });
});
