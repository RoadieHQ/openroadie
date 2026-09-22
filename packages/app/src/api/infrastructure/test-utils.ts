import { vi, type Mock } from 'vitest';

/**
 * Shared test utilities for API client tests.
 */

/** Build a mock Response object for fetch mock return values. */
export function mockResponse(
  body: unknown,
  ok = true,
  status?: number,
): Response {
  const resolvedStatus = status ?? (ok ? 200 : 500);
  const responseBody = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(responseBody, {
    status: resolvedStatus,
    statusText: ok ? 'OK' : 'Error',
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Build a 204 No Content response. */
export function mockNoContent(): Response {
  return new Response(null, { status: 204, statusText: 'No Content' });
}

/**
 * A `fetch` stand-in typed as the real thing.
 *
 * `vi.fn()` on its own infers a signature the clients won't accept, so every
 * client test would otherwise annotate the mock itself. Named so the intent is
 * the mock, not the typing workaround.
 */
export function mockFetchFn(): Mock<typeof fetch> {
  return vi.fn<typeof fetch>();
}

/**
 * The `RequestInit` of a recorded fetch call, asserted present.
 *
 * `mock.calls[n][1]` is optional on fetch's signature, so every assertion about
 * a request's method or body would otherwise need its own non-null assertion.
 */
export function fetchCallInit(
  mock: Mock<typeof fetch>,
  callIndex = 0,
): RequestInit {
  const init = mock.mock.calls.at(callIndex)?.[1];
  if (!init) {
    throw new Error(`fetch call ${callIndex} was made without a RequestInit`);
  }
  return init;
}

/** The JSON-decoded body of a recorded fetch call. */
export function fetchCallBody<TBody = unknown>(
  mock: Mock<typeof fetch>,
  callIndex = 0,
): TBody {
  const { body } = fetchCallInit(mock, callIndex);
  if (typeof body !== 'string') {
    throw new Error(`fetch call ${callIndex} had no string body`);
  }
  return JSON.parse(body) as TBody;
}
