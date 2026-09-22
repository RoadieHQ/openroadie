import { useState, type ReactElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  render as rtlRender,
  renderHook as rtlRenderHook,
  type RenderHookOptions,
  type RenderOptions,
} from '@testing-library/react';

/** A react-query client tuned for tests (no retries, no cache carry-over). */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
}

/**
 * Wraps children in a fresh react-query client. Use as a `render`/`renderHook`
 * wrapper for anything that transitively uses a query hook. Holds one client per
 * mount (via `useState`) so re-renders within a test reuse the same cache.
 */
export function TestQueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createTestQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * `@testing-library/react`'s `render`, pre-wrapped in `TestQueryProvider`. Use
 * for any component that transitively uses a query hook. Extra `options` still
 * merge in; pass your own `wrapper` to override.
 */
export function renderWithQuery(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return rtlRender(ui, { wrapper: TestQueryProvider, ...options });
}

/** `renderHook`, pre-wrapped in `TestQueryProvider`. */
export function renderHookWithQuery<Result, Props>(
  render: (initialProps: Props) => Result,
  options?: Omit<RenderHookOptions<Props>, 'wrapper'>,
) {
  return rtlRenderHook(render, { wrapper: TestQueryProvider, ...options });
}
