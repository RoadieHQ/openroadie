export const KNOWN_INTEGRATION_AUTH_TYPES = [
  'header',
  'basic',
  'bearer-token',
  'oauth2-client-credentials',
  'oauth2-jwt-bearer',
  'none',
] as const;

export type KnownIntegrationAuthType =
  (typeof KNOWN_INTEGRATION_AUTH_TYPES)[number];

export type IntegrationAuthType =
  | KnownIntegrationAuthType
  | (string & NonNullable<unknown>);
