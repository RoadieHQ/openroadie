import { OAuthUsersApi } from './OAuthUsersApi';
import { DiscoveryApi, FetchApi } from '@roadiehq/core-plugin-api';
import { User, BackendToken, SuggestedRole } from './types';
import { parseErrorResponse } from '../../helpers/errorResponse';

export class OAuthUsersClient implements OAuthUsersApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly fetchFn: typeof fetch;
  private baseUrl: string = '';

  constructor(options: { discoveryApi: DiscoveryApi; fetchApi?: FetchApi }) {
    this.discoveryApi = options.discoveryApi;
    // eslint-disable-next-line no-restricted-syntax -- pre-existing consumers construct this without a fetchApi and rely on ambient browser credentials; keep the fallback until they inject one.
    this.fetchFn = options.fetchApi?.fetch ?? fetch;
  }

  getBaseUrl: () => Promise<string> = async () => {
    if (!this.baseUrl) {
      this.baseUrl = await this.discoveryApi.getBaseUrl('roadie-auth');
    }
    return this.baseUrl;
  };

  async createApiToken(name: string): Promise<BackendToken> {
    const url = await this.getBaseUrl();
    const response = await this.fetchFn(`${url}/api-tokens`, {
      method: 'POST',
      body: JSON.stringify({ name }),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      await parseErrorResponse(response);
    }
    const payload = await response.json();

    return payload;
  }

  async revokeApiToken(id: string): Promise<string> {
    const url = await this.getBaseUrl();
    const response = await this.fetchFn(`${url}/api-tokens/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      await parseErrorResponse(response);
    }
    return id;
  }

  async listApiTokens(): Promise<BackendToken[]> {
    type TokenResponseItem = {
      tenant: string;
      userId: string;
      tokenName: string;
      clientId: string;
      creationDate: string;
      expirationDate: string;
      id: string;
      maskedToken: string;
    };
    const url = await this.getBaseUrl();
    const response = await this.fetchFn(`${url}/api-tokens`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      await parseErrorResponse(response);
    }
    const payload: TokenResponseItem[] = (await response.json())?.tokens;

    return payload
      ? payload.map(i => ({
          tokenName: i.tokenName,
          createdAt: i.creationDate,
          expiresAt: i.expirationDate,
          id: i.id,
          maskedToken: i.maskedToken,
        }))
      : [];
  }

  async getUsers(): Promise<User[]> {
    const url = await this.getBaseUrl();
    const response = await this.fetchFn(`${url}/users`);
    if (!response.ok) {
      await parseErrorResponse(response);
    }
    const payload = await response.json();
    return payload.users;
  }

  async getUser(userId: string): Promise<User> {
    const url = await this.getBaseUrl();
    const response = await this.fetchFn(`${url}/users/${userId}`);
    if (!response.ok) {
      await parseErrorResponse(response);
    }
    const payload = await response.json();
    return payload;
  }

  async getSuggestedRoles(): Promise<SuggestedRole[]> {
    const url = await this.getBaseUrl();
    const response = await this.fetchFn(`${url}/suggested-user-roles`);
    if (!response.ok) {
      await parseErrorResponse(response);
    }
    const payload = await response.json();
    return payload;
  }

  async deleteUser(userId: string): Promise<void> {
    const url = await this.getBaseUrl();
    const response = await this.fetchFn(`${url}/users/${userId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      await parseErrorResponse(response);
    }
  }

  async inviteUser(emails: string[]): Promise<Response> {
    const newUsers = { emails: emails.map(it => it.toLowerCase()) };
    const url = await this.getBaseUrl();
    const response = await this.fetchFn(`${url}/users`, {
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify(newUsers),
    });
    if (!response.ok) {
      await parseErrorResponse(response);
    }
    const payload = await response.json();
    return payload;
  }
}
