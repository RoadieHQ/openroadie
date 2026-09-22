import { act, renderHook, waitFor } from '@testing-library/react';
import { TestQueryProvider } from '../../test-utils';
import { useWebhooks } from './use-webhooks';

const mockWebhooks = {
  listSubscriptions: vi.fn(),
  listTokens: vi.fn(),
  createToken: vi.fn(),
  deleteSubscription: vi.fn(),
  deleteToken: vi.fn(),
};

vi.mock('../../api', () => ({
  useWebhooksApi: () => mockWebhooks,
}));

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWebhooks.listTokens.mockResolvedValue({
    items: [
      {
        id: 'token-1',
        label: 'Deployments',
        createdAt: '2026-07-01T00:00:00.000Z',
        lastUsedAt: null,
      },
    ],
  });
  mockWebhooks.listSubscriptions.mockResolvedValue({
    items: [
      {
        id: 'subscription-1',
        url: 'https://example.com/hook',
        filters: {},
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
  });
});

describe('useWebhooks', () => {
  it('removes tokens immediately while deletion is pending', async () => {
    const deletion = deferred<void>();
    mockWebhooks.deleteToken.mockReturnValue(deletion.promise);
    mockWebhooks.listTokens
      .mockResolvedValueOnce({
        items: [
          {
            id: 'token-1',
            label: 'Deployments',
            createdAt: '2026-07-01T00:00:00.000Z',
            lastUsedAt: null,
          },
        ],
      })
      .mockResolvedValue({ items: [] });
    const { result } = renderHook(() => useWebhooks(), {
      wrapper: TestQueryProvider,
    });
    await waitFor(() => expect(result.current.tokens).toHaveLength(1));

    let deletePromise: Promise<void> | undefined;
    act(() => {
      deletePromise = result.current.deleteToken('token-1');
    });
    await waitFor(() => expect(result.current.tokens).toEqual([]));
    expect(result.current.deletingToken).toBe(true);

    deletion.resolve();
    await act(async () => deletePromise);
    await waitFor(() => expect(result.current.deletingToken).toBe(false));
  });

  it('restores subscriptions when deletion fails', async () => {
    mockWebhooks.deleteSubscription.mockRejectedValue(
      new Error('Delete failed'),
    );
    const { result } = renderHook(() => useWebhooks(), {
      wrapper: TestQueryProvider,
    });
    await waitFor(() => expect(result.current.subscriptions).toHaveLength(1));

    let deleteError: unknown;
    await act(async () => {
      try {
        await result.current.deleteSubscription('subscription-1');
      } catch (error: unknown) {
        deleteError = error;
      }
    });
    expect(deleteError).toEqual(new Error('Delete failed'));

    await waitFor(() =>
      expect(result.current.subscriptions.map(item => item.id)).toEqual([
        'subscription-1',
      ]),
    );
  });
});
