import type { OpenRoadieConfig } from './config';

/**
 * Result of a single request. `ok` distinguishes a real 2xx body from a
 * reachable backend that returned an error status (e.g. 404 before a route
 * exists, 500 on `/readiness` while initializing) and from an unreachable
 * backend.
 */
export interface HttpResult<T> {
  ok: boolean;
  status: number;
  unreachable: boolean;
  body?: T;
  errorText?: string;
}

export function httpFailureReason(res: HttpResult<unknown>): string {
  return res.unreachable
    ? 'backend unreachable'
    : res.errorText && res.errorText.trim() !== ''
      ? res.errorText
      : `request failed (status ${res.status})`;
}

/**
 * A thin HTTP client over the real OSS backend. Each method returns an
 * `HttpResult` rather than throwing, so callers (the status aggregator fanning
 * out across endpoints, or a verb building one request) can reason about
 * partial failures — a down server, a route that does not exist yet, a 4xx with
 * a message — without one failure aborting the others.
 */
export class OpenRoadieHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(config: OpenRoadieConfig, fetchImpl?: typeof globalThis.fetch) {
    this.baseUrl = config.backendUrl.replace(/\/+$/, '');
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
  }

  get url(): string {
    return this.baseUrl;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { Accept: 'application/json', ...extra };
  }

  /**
   * Read a 2xx body, or classify the failure. `requireJson` preserves the M0
   * GET contract — a 2xx that is not JSON is a soft failure (`ok: false`) — so
   * the status aggregator keeps treating "reachable but not JSON" as not ready.
   * Write verbs tolerate an empty / non-JSON body (204, or a 201 with no body)
   * and stay `ok: true`.
   */
  private async send<T>(
    path: string,
    init: RequestInit,
    requireJson: boolean,
  ): Promise<HttpResult<T>> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch {
      return { ok: false, status: 0, unreachable: true };
    }

    if (!response.ok) {
      let errorText: string | undefined;
      try {
        errorText = await response.text();
      } catch {
        errorText = undefined;
      }
      return {
        ok: false,
        status: response.status,
        unreachable: false,
        errorText,
      };
    }

    if (response.status === 204) {
      return { ok: true, status: response.status, unreachable: false };
    }

    try {
      const body = (await response.json()) as T;
      return { ok: true, status: response.status, unreachable: false, body };
    } catch {
      // Reachable and 2xx but not JSON. GET treats this as a soft failure
      // (M0 semantics); write verbs accept it as a bodyless success.
      return {
        ok: !requireJson,
        status: response.status,
        unreachable: false,
      };
    }
  }

  async get<T>(path: string): Promise<HttpResult<T>> {
    return this.send<T>(path, { method: 'GET', headers: this.headers() }, true);
  }

  async post<T>(path: string, body?: unknown): Promise<HttpResult<T>> {
    const hasBody = body !== undefined;
    return this.send<T>(
      path,
      {
        method: 'POST',
        headers: this.headers(
          hasBody ? { 'Content-Type': 'application/json' } : undefined,
        ),
        body: hasBody ? JSON.stringify(body) : undefined,
      },
      false,
    );
  }

  async patch<T>(path: string, body?: unknown): Promise<HttpResult<T>> {
    const hasBody = body !== undefined;
    return this.send<T>(
      path,
      {
        method: 'PATCH',
        headers: this.headers(
          hasBody ? { 'Content-Type': 'application/json' } : undefined,
        ),
        body: hasBody ? JSON.stringify(body) : undefined,
      },
      false,
    );
  }

  async put<T>(path: string, body?: unknown): Promise<HttpResult<T>> {
    const hasBody = body !== undefined;
    return this.send<T>(
      path,
      {
        method: 'PUT',
        headers: this.headers(
          hasBody ? { 'Content-Type': 'application/json' } : undefined,
        ),
        body: hasBody ? JSON.stringify(body) : undefined,
      },
      false,
    );
  }
}
