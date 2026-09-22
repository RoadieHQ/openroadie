import { BackendToken, SuggestedRole, User } from './types';

export interface OAuthUsersApi {
  createApiToken(name: string): Promise<BackendToken>;
  revokeApiToken(id: string): Promise<string>;
  listApiTokens(): Promise<BackendToken[]>;
  getUsers(): Promise<User[]>;
  getUser(id: string): Promise<User>;
  getSuggestedRoles(): Promise<SuggestedRole[]>;
  deleteUser(id: string): Promise<void>;
  inviteUser(user: string[]): Promise<Response>;
}
