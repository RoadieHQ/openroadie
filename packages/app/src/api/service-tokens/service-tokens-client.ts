import { ResponseError } from '../infrastructure/errors';
import {
  workspaceOwnershipFields,
  type WorkspaceOwnershipFields,
} from '../workspace-scope';

export interface ServiceToken extends WorkspaceOwnershipFields {
  id: string;
  tokenName: string;
  createdBy: string;
  createdAt: number;
  expiresAt: number | null;
  maskedToken: string;
}

export interface CreateServiceTokenParams {
  name: string;
  expiresInDays?: number | null;
  /** Restrict the token to these scopes (`resource:action[:target]`). Omit for an unrestricted token. */
  scopes?: string[];
}

export interface CreateServiceTokenResponse extends ServiceToken {
  token: string;
}

export interface RotateServiceTokenResponse extends CreateServiceTokenResponse {
  revokedTokenId: string;
}

export interface ListServiceTokensOptions {
  limit?: number;
  cursor?: string;
}

export interface ListServiceTokensResponse {
  tokens: ServiceToken[];
  nextCursor?: string;
}

type RawServiceToken = Omit<ServiceToken, 'ownership' | 'workspaceId'> & {
  workspaceId: string;
};
type RawCreateServiceTokenResponse = RawServiceToken & { token: string };
type RawRotateServiceTokenResponse = RawCreateServiceTokenResponse & {
  revokedTokenId: string;
};

function withOwnership<T extends RawServiceToken>(token: T): T & ServiceToken {
  return {
    ...token,
    ...workspaceOwnershipFields(token.workspaceId),
  };
}

export class ServiceTokensClient {
  constructor(
    private baseUrl: string,
    private fetch: typeof globalThis.fetch,
  ) {}

  async list(
    options: ListServiceTokensOptions = {},
  ): Promise<ListServiceTokensResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', options.limit.toString());
    if (options.cursor) params.set('cursor', options.cursor);

    const url = params.toString()
      ? `${this.baseUrl}?${params.toString()}`
      : this.baseUrl;

    const response = await this.fetch(url);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    const result = (await response.json()) as {
      tokens: RawServiceToken[];
      nextCursor?: string;
    };
    return {
      ...result,
      tokens: result.tokens.map(withOwnership),
    };
  }

  async create(
    params: CreateServiceTokenParams,
  ): Promise<CreateServiceTokenResponse> {
    const response = await this.fetch(this.baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return withOwnership(
      (await response.json()) as RawCreateServiceTokenResponse,
    );
  }

  async rotate(
    id: string,
    expiresInDays?: number | null,
  ): Promise<RotateServiceTokenResponse> {
    const response = await this.fetch(`${this.baseUrl}/${id}/rotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresInDays }),
    });
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return withOwnership(
      (await response.json()) as RawRotateServiceTokenResponse,
    );
  }

  async revoke(id: string): Promise<void> {
    const response = await this.fetch(`${this.baseUrl}/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
  }
}
