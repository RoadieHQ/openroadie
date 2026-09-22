export interface AuthSession {
  getAccessToken(): Promise<string>;
  getOrganizationId?(): string | undefined;
  login(): Promise<void>;
  logout(): Promise<void>;
}

export interface AuthConfig {
  domain: string;
  clientId: string;
  audience: string;
  organization?: string;
}
