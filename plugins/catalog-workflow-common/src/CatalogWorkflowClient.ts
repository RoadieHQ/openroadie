import {
  WorkflowDefinition,
  WorkflowType,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  GraphLayout,
  GraphLayoutNode,
  GraphLayoutEdge,
} from './types';

interface DiscoveryLike {
  getBaseUrl(pluginId: string): Promise<string>;
}

interface FetchLike {
  fetch: typeof fetch;
}

export class CatalogWorkflowClient {
  private readonly discoveryApi: DiscoveryLike;
  private readonly fetchFn: typeof fetch;

  // fetchApi is required on purpose: a global-fetch fallback here is how
  // internal calls silently lose credential resolution (sc-34243) — inject
  // internalFetchServiceRef (or `.asService()`).
  constructor(options: { discoveryApi: DiscoveryLike; fetchApi: FetchLike }) {
    this.discoveryApi = options.discoveryApi;
    this.fetchFn = options.fetchApi.fetch;
  }

  private async getBaseUrl(): Promise<string> {
    return this.discoveryApi.getBaseUrl('catalog-workflow');
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const baseUrl = await this.getBaseUrl();
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    new Headers(init?.headers).forEach((value, key) => {
      headers.set(key, value);
    });
    const response = await this.fetchFn(`${baseUrl}${path}`, {
      ...init,
      headers,
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(
        error.error?.message ||
          error.message ||
          // statusText is empty over HTTP/2, so name the status explicitly.
          `Request failed with status ${response.status}`,
      );
    }

    return response.json();
  }

  async list(options?: {
    enabled?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
    workflowType?: WorkflowType;
    workspaceId?: string;
  }): Promise<{ data: WorkflowDefinition[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.enabled !== undefined) {
      params.set('enabled', String(options.enabled));
    }
    if (options?.search) {
      params.set('search', options.search);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    if (options?.workflowType) {
      params.set('workflowType', options.workflowType);
    }

    const query = params.toString();
    return this.request(`/workflows${query ? `?${query}` : ''}`, {
      headers: options?.workspaceId
        ? { 'x-openroadie-workspace-id': options.workspaceId }
        : undefined,
    });
  }

  async get(id: string): Promise<WorkflowDefinition> {
    const result = await this.request<{ data: WorkflowDefinition }>(
      `/workflows/${id}`,
    );
    return result.data;
  }

  async create(
    input: Omit<CreateWorkflowInput, 'createdBy'>,
  ): Promise<WorkflowDefinition> {
    const result = await this.request<{ data: WorkflowDefinition }>(
      '/workflows',
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    );
    return result.data;
  }

  async update(
    id: string,
    input: UpdateWorkflowInput,
  ): Promise<WorkflowDefinition> {
    const result = await this.request<{ data: WorkflowDefinition }>(
      `/workflows/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    );
    return result.data;
  }

  async delete(id: string): Promise<void> {
    await this.request(`/workflows/${id}`, { method: 'DELETE' });
  }

  async duplicate(id: string, newName?: string): Promise<WorkflowDefinition> {
    const result = await this.request<{ data: WorkflowDefinition }>(
      `/workflows/${id}/duplicate`,
      {
        method: 'POST',
        body: JSON.stringify({ name: newName }),
      },
    );
    return result.data;
  }

  async getScheduleInfo(id: string): Promise<{ nextRunAt: string | null }> {
    const result = await this.request<{ data: { nextRunAt: string | null } }>(
      `/workflows/${id}/schedule`,
    );
    return result.data;
  }

  async storeDataSource(input: {
    workflowId: string;
    data: unknown[];
  }): Promise<{ recordCount: number }> {
    return this.request('/data-sources', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async getGraphLayouts(): Promise<{ data: GraphLayout[] }> {
    return this.request('/graph-layouts');
  }

  async getGraphLayout(name: string): Promise<{ data: GraphLayout }> {
    return this.request(`/graph-layouts/${encodeURIComponent(name)}`);
  }

  async saveGraphLayout(
    name: string,
    input: {
      nodes?: GraphLayoutNode[];
      edges?: GraphLayoutEdge[];
      viewport?: { x: number; y: number; zoom: number } | null;
    },
  ): Promise<{ data: GraphLayout }> {
    return this.request(`/graph-layouts/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async deleteGraphLayout(name: string): Promise<void> {
    await this.request(`/graph-layouts/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }
}
