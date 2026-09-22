import { ResponseError } from '../infrastructure/errors';
import type {
  Action,
  ActionInput,
  ActionParam,
  ActionStep,
  ActionVersion as CommonActionVersion,
  JsonSchema,
} from '@roadiehq/actions-common';
import type { WorkspaceOwnershipFields } from '../workspace-scope';

export type {
  Action,
  ActionInput,
  ActionParam,
  ActionRequest,
  ActionStep,
  ParamType,
  JsonSchema,
} from '@roadiehq/actions-common';

export type ActionVersion = CommonActionVersion & WorkspaceOwnershipFields;

/** An action as returned by the backend, with its compiled input schema. */
export type ActionWithSchema = Action &
  WorkspaceOwnershipFields & { inputSchema?: JsonSchema };

export interface PageOptions {
  search?: string;
  limit?: number;
  offset?: number;
}

/** Outcome of one executed step. */
export interface StepResult {
  id: string;
  ok: boolean;
  status: number;
  data?: unknown;
  error?: unknown;
}

/**
 * Execute envelope: top-level ok/status/data/error mirror the final executed
 * step; `steps` lists every executed step's result in order.
 */
export interface ExecuteResult {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: unknown;
  steps: StepResult[];
}

/** An unsaved action draft, executed without persisting it. */
export interface DraftExecuteSpec {
  parameters: ActionParam[];
  steps: ActionStep[];
}

export interface ActionsApi {
  list(
    options?: PageOptions,
  ): Promise<{ items: ActionWithSchema[]; total: number }>;
  get(id: string): Promise<ActionWithSchema | undefined>;
  create(input: ActionInput): Promise<ActionWithSchema>;
  update(id: string, input: Partial<ActionInput>): Promise<ActionWithSchema>;
  delete(id: string): Promise<void>;
  listVersions(
    id: string,
    options?: PageOptions,
  ): Promise<{ items: ActionVersion[]; total: number }>;
  getVersion(id: string, version: number): Promise<ActionVersion | undefined>;
  restoreVersion(id: string, version: number): Promise<ActionWithSchema>;
  execute(
    idOrSlug: string,
    inputs: Record<string, unknown>,
  ): Promise<ExecuteResult>;
  executeDraft(
    spec: DraftExecuteSpec,
    inputs: Record<string, unknown>,
  ): Promise<ExecuteResult>;
}

export class ActionsClient implements ActionsApi {
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
  ): Promise<{ items: ActionWithSchema[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.search) {
      params.set('search', options.search);
    }
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const queryString = params.toString();
    const path = `/${queryString ? `?${queryString}` : ''}`;
    return this.request<{ items: ActionWithSchema[]; total: number }>(path);
  }

  async get(id: string): Promise<ActionWithSchema | undefined> {
    try {
      return await this.request<ActionWithSchema>(`/${id}`);
    } catch (e: unknown) {
      if (e instanceof ResponseError && e.statusCode === 404) {
        return undefined;
      }
      throw e;
    }
  }

  async create(input: ActionInput): Promise<ActionWithSchema> {
    return this.request<ActionWithSchema>('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async update(
    id: string,
    input: Partial<ActionInput>,
  ): Promise<ActionWithSchema> {
    return this.request<ActionWithSchema>(`/${id}`, {
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
  ): Promise<{ items: ActionVersion[]; total: number }> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) {
      params.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      params.set('offset', String(options.offset));
    }
    const queryString = params.toString();
    const path = `/${id}/versions${queryString ? `?${queryString}` : ''}`;
    return this.request<{ items: ActionVersion[]; total: number }>(path);
  }

  async getVersion(
    id: string,
    version: number,
  ): Promise<ActionVersion | undefined> {
    try {
      return await this.request<ActionVersion>(`/${id}/versions/${version}`);
    } catch (e: unknown) {
      if (e instanceof ResponseError && e.statusCode === 404) {
        return undefined;
      }
      throw e;
    }
  }

  async restoreVersion(id: string, version: number): Promise<ActionWithSchema> {
    return this.request<ActionWithSchema>(
      `/${id}/versions/${version}/restore`,
      { method: 'POST' },
    );
  }

  async execute(
    idOrSlug: string,
    inputs: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    return this.request<ExecuteResult>(`/${idOrSlug}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs }),
    });
  }

  async executeDraft(
    spec: DraftExecuteSpec,
    inputs: Record<string, unknown>,
  ): Promise<ExecuteResult> {
    return this.request<ExecuteResult>('/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...spec, inputs }),
    });
  }
}
