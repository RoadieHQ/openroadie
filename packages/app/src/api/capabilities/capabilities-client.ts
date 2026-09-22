import { ResponseError } from '../infrastructure/errors';
import type { WorkspaceOwnershipFields } from '../workspace-scope';

export interface Capability extends WorkspaceOwnershipFields {
  id: string;
  slug: string;
  name: string;
  description: string;
  instructions: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityVersion extends WorkspaceOwnershipFields {
  id: string;
  capabilityId: string;
  slug: string;
  version: number;
  name: string;
  description: string;
  instructions: string;
  createdAt: string;
}

export interface CapabilityInput {
  name: string;
  // Optional on create — the backend derives it from the name when omitted.
  slug?: string;
  description: string;
  instructions: string;
}

export interface PageOptions {
  limit?: number;
  offset?: number;
}

export interface CapabilitiesApi {
  list(options?: PageOptions): Promise<{ items: Capability[]; total: number }>;
  search(
    query: string,
    options?: PageOptions,
  ): Promise<{ items: Capability[]; total: number }>;
  get(id: string): Promise<Capability | undefined>;
  create(input: CapabilityInput): Promise<Capability>;
  update(id: string, input: Partial<CapabilityInput>): Promise<Capability>;
  delete(id: string): Promise<void>;
  listVersions(
    id: string,
    options?: PageOptions,
  ): Promise<{ items: CapabilityVersion[]; total: number }>;
  getVersion(
    id: string,
    version: number,
  ): Promise<CapabilityVersion | undefined>;
  restoreVersion(id: string, version: number): Promise<Capability>;
}

export class CapabilitiesClient implements CapabilitiesApi {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(baseUrl: string, fetch: typeof globalThis.fetch) {
    this.baseUrl = baseUrl;
    this.fetch = fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    return JSON.parse(text);
  }

  async list(
    options?: PageOptions,
  ): Promise<{ items: Capability[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const queryString = params.toString();
    const path = `/${queryString ? `?${queryString}` : ''}`;
    return this.request<{ items: Capability[]; total: number }>(path);
  }

  async search(
    query: string,
    options?: PageOptions,
  ): Promise<{ items: Capability[]; total: number }> {
    const params = new URLSearchParams();
    params.set('q', query);
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    return this.request<{ items: Capability[]; total: number }>(
      `/search?${params.toString()}`,
    );
  }

  async get(id: string): Promise<Capability | undefined> {
    try {
      return await this.request<Capability>(`/${id}`);
    } catch (e: unknown) {
      if (e instanceof ResponseError && e.statusCode === 404) {
        return undefined;
      }
      throw e;
    }
  }

  async create(input: CapabilityInput): Promise<Capability> {
    return this.request<Capability>('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async update(
    id: string,
    input: Partial<CapabilityInput>,
  ): Promise<Capability> {
    return this.request<Capability>(`/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async delete(id: string): Promise<void> {
    await this.request<void>(`/${id}`, { method: 'DELETE' });
  }

  async listVersions(
    id: string,
    options?: PageOptions,
  ): Promise<{ items: CapabilityVersion[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const queryString = params.toString();
    const path = `/${id}/versions${queryString ? `?${queryString}` : ''}`;
    return this.request<{ items: CapabilityVersion[]; total: number }>(path);
  }

  async getVersion(
    id: string,
    version: number,
  ): Promise<CapabilityVersion | undefined> {
    try {
      return await this.request<CapabilityVersion>(
        `/${id}/versions/${version}`,
      );
    } catch (e: unknown) {
      if (e instanceof ResponseError && e.statusCode === 404) {
        return undefined;
      }
      throw e;
    }
  }

  async restoreVersion(id: string, version: number): Promise<Capability> {
    return this.request<Capability>(`/${id}/versions/${version}/restore`, {
      method: 'POST',
    });
  }
}
