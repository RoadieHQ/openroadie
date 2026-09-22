import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useActions } from './use-actions';

const mockApi = {
  list: vi.fn(),
};

vi.mock('../../api', () => ({
  useActions: () => mockApi,
}));

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
});

describe('useActions', () => {
  it('returns the actions list from the shared query cache', async () => {
    mockApi.list.mockResolvedValue({
      items: [{ id: 'a1', name: 'A1' }],
      total: 1,
    });
    const { result } = renderHook(() => useActions(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.actions).toEqual([{ id: 'a1', name: 'A1' }]);
    expect(result.current.total).toBe(1);
    expect(mockApi.list).toHaveBeenCalledTimes(1);
  });
});
