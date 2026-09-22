import { renderHook } from '@testing-library/react';
import { useOverviewLoadErrorToast } from './use-overview-load-error-toast';

const mockAlertApi = { post: vi.fn() };
vi.mock('../../api', () => ({
  useAlert: () => mockAlertApi,
}));

describe('useOverviewLoadErrorToast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts an error toast once per Error instance', () => {
    const error = new Error('Boom');
    const { rerender } = renderHook(
      ({ err }) => useOverviewLoadErrorToast(err),
      { initialProps: { err: error as Error | null } },
    );
    expect(mockAlertApi.post).toHaveBeenCalledWith({
      message: 'Boom',
      severity: 'error',
    });
    expect(mockAlertApi.post).toHaveBeenCalledTimes(1);

    rerender({ err: error });
    expect(mockAlertApi.post).toHaveBeenCalledTimes(1);
  });

  it('does not post when error is null', () => {
    renderHook(() => useOverviewLoadErrorToast(null));
    expect(mockAlertApi.post).not.toHaveBeenCalled();
  });

  it('does not repost after unmount and remount with the same cached error', () => {
    const error = new Error('Boom');
    const { unmount } = renderHook(() => useOverviewLoadErrorToast(error));
    expect(mockAlertApi.post).toHaveBeenCalledTimes(1);

    unmount();
    renderHook(() => useOverviewLoadErrorToast(error));
    expect(mockAlertApi.post).toHaveBeenCalledTimes(1);
  });

  it('posts again for a distinct Error instance', () => {
    const first = new Error('First');
    const { rerender } = renderHook(
      ({ err }) => useOverviewLoadErrorToast(err),
      { initialProps: { err: first as Error | null } },
    );
    expect(mockAlertApi.post).toHaveBeenCalledTimes(1);

    rerender({ err: new Error('Second') });
    expect(mockAlertApi.post).toHaveBeenCalledTimes(2);
  });
});
