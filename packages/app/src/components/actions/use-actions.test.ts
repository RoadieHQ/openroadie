import { renderHook, waitFor } from '@testing-library/react';
import { TestQueryProvider } from '../../test-utils';
import { useActions } from './use-actions';

const mockList = vi.fn();
const mockDelete = vi.fn();
vi.mock('../../api', () => ({
  useActions: () => ({ list: mockList, delete: mockDelete }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useActions', () => {
  it('reports loading from the first render until the fetch resolves', async () => {
    const pending = deferred<{ items: unknown[]; total: number }>();
    mockList.mockReturnValue(pending.promise);

    const { result } = renderHook(() => useActions(), {
      wrapper: TestQueryProvider,
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.actions).toEqual([]);

    pending.resolve({ items: [{ id: 'a' }], total: 1 });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.actions).toHaveLength(1);
  });

  it('settles into an empty, non-loading state when there are no actions', async () => {
    mockList.mockResolvedValue({ items: [], total: 0 });

    const { result } = renderHook(() => useActions(), {
      wrapper: TestQueryProvider,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.actions).toEqual([]);
  });
});
