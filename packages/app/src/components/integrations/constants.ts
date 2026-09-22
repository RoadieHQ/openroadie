import type { KnownIntegrationAuthType } from '../../api/workflow/integration-auth-types';

export type { KnownIntegrationAuthType as IntegrationAuthType } from '../../api/workflow/integration-auth-types';

export type IntegrationType =
  | 'scm'
  | 'ci-cd'
  | 'monitoring'
  | 'incident-management'
  | 'infrastructure'
  | 'security'
  | 'communication'
  | 'project-management'
  | 'analytics'
  | 'other';

export type IntegrationBackendType = 'http' | 'aws';

export const INTEGRATION_TYPES: ReadonlyArray<{
  value: IntegrationType;
  label: string;
}> = [
  { value: 'scm', label: 'Source Control' },
  { value: 'ci-cd', label: 'CI / CD' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'incident-management', label: 'Incident Management' },
  { value: 'infrastructure', label: 'Infrastructure' },
  { value: 'security', label: 'Security' },
  { value: 'communication', label: 'Communication' },
  { value: 'project-management', label: 'Project Management' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'other', label: 'Other' },
];

export const INTEGRATION_BACKEND_TYPES: ReadonlyArray<{
  value: IntegrationBackendType;
  label: string;
}> = [
  { value: 'http', label: 'HTTP' },
  { value: 'aws', label: 'AWS' },
];

export const INTEGRATION_AUTH_TYPES: ReadonlyArray<{
  value: KnownIntegrationAuthType;
  label: string;
}> = [
  { value: 'none', label: 'None' },
  { value: 'header', label: 'Header' },
  { value: 'basic', label: 'Basic' },
  { value: 'bearer-token', label: 'Bearer Token' },
  { value: 'oauth2-client-credentials', label: 'OAuth2 Client Credentials' },
  { value: 'oauth2-jwt-bearer', label: 'OAuth2 JWT Bearer' },
];

export const INTEGRATION_HTTP_BASE_URL_PLACEHOLDER =
  'https://api.example.com' as const;
