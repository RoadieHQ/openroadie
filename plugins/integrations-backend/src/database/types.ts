/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {
  IntegrationType,
  AuthType,
  HeaderAuthConfig,
  BasicAuthConfig,
  BearerTokenAuthConfig,
  OAuth2ClientCredentialsAuthConfig,
  OAuth2JwtBearerAuthConfig,
  AuthConfig,
  Integration,
  BackendType,
  GithubAppInfo,
} from '@roadiehq/integrations-node';

export type {
  IntegrationType,
  AuthType,
  HeaderAuthConfig,
  BasicAuthConfig,
  BearerTokenAuthConfig,
  OAuth2ClientCredentialsAuthConfig,
  OAuth2JwtBearerAuthConfig,
  AuthConfig,
  Integration,
  BackendType,
  GithubAppInfo,
};

export interface IntegrationRow {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  type: string;
  host: string;
  auth_type: string;
  auth_config: unknown;
  requests_per_hour: number;
  requests_per_second: number | null;
  burst_capacity: number | null;
  backend_type: string;
  config: unknown;
  logo_svg: string | null;
  graphql_path: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateIntegrationInput {
  name: string;
  slug: string;
  type: IntegrationType;
  host: string;
  authType?: AuthType;
  authConfig?: AuthConfig;
  backendType?: BackendType;
  requestsPerHour?: number;
  requestsPerSecond?: number;
  burstCapacity?: number;
  config?: Record<string, unknown>;
  logoSvg?: string | null;
  graphqlPath?: string | null;
  createdBy: string;
}

export interface UpdateIntegrationInput {
  name?: string;
  slug?: string;
  type?: IntegrationType;
  host?: string;
  authType?: AuthType;
  authConfig?: AuthConfig | null;
  backendType?: BackendType;
  requestsPerHour?: number;
  requestsPerSecond?: number;
  burstCapacity?: number;
  config?: Record<string, unknown>;
  logoSvg?: string | null;
  graphqlPath?: string | null;
}
