import { describe, expect, it } from 'vitest';
import type { FieldErrors } from 'react-hook-form';
import { getFirstInvalidIntegrationFieldPath } from './integration-form-focus-field';
import type { IntegrationFormValues } from './integration-schema';

const httpValues = (
  overrides: Partial<IntegrationFormValues>,
): IntegrationFormValues => ({
  name: 'GitHub',
  slug: 'github',
  type: 'scm',
  logoSlug: '',
  backendType: 'http',
  host: 'https://api.github.com',
  authType: 'none',
  authHeaders: [],
  basicUsername: '',
  basicPassword: '',
  bearerToken: '',
  oauth2ClientId: '',
  oauth2ClientSecret: '',
  oauth2TokenUrl: '',
  oauth2Audience: '',
  oauth2Scope: '',
  jwtIssuer: '',
  jwtPrivateKey: '',
  jwtTokenUrl: '',
  jwtAudience: '',
  jwtScope: '',
  jwtSubject: '',
  defaultHeaders: [],
  requestsPerHour: '',
  requestsPerSecond: '',
  burstCapacity: '',
  caCertificate: '',
  graphqlPath: '',
  ...overrides,
});

const opts = {
  isEdit: true,
  systemIntegration: false,
  readOnly: false,
};

// Cast because spreading a Partial widens `backendType`, which is the union's
// discriminant — the spread result no longer narrows to one branch.
const awsValues = (
  overrides: Partial<IntegrationFormValues>,
): IntegrationFormValues =>
  ({
    name: 'AWS',
    slug: 'aws',
    type: 'infrastructure',
    logoSlug: '',
    backendType: 'aws',
    host: '',
    authType: 'none',
    authHeaders: [],
    basicUsername: '',
    basicPassword: '',
    bearerToken: '',
    oauth2ClientId: '',
    oauth2ClientSecret: '',
    oauth2TokenUrl: '',
    oauth2Audience: '',
    oauth2Scope: '',
    jwtIssuer: '',
    jwtPrivateKey: '',
    jwtTokenUrl: '',
    jwtAudience: '',
    jwtScope: '',
    jwtSubject: '',
    defaultHeaders: [],
    requestsPerHour: '',
    requestsPerSecond: '',
    burstCapacity: '',
    caCertificate: '',
    awsProfiles: [
      { name: '', accountId: '', roleName: '', externalId: '', region: '' },
    ],
    ...overrides,
  }) as IntegrationFormValues;

describe('getFirstInvalidIntegrationFieldPath', () => {
  it('returns host when name and slug are valid but host is invalid', () => {
    const values = httpValues({ host: '' });
    const errors = {
      host: { message: 'URL is required', type: 'too_small' },
    } as FieldErrors<IntegrationFormValues>;
    expect(getFirstInvalidIntegrationFieldPath(errors, values, opts)).toBe(
      'host',
    );
  });

  it('returns name when name is invalid before host', () => {
    const values = httpValues({ name: '', host: '' });
    const errors = {
      name: { message: 'Name is required', type: 'too_small' },
      host: { message: 'URL is required', type: 'too_small' },
    } as FieldErrors<IntegrationFormValues>;
    expect(getFirstInvalidIntegrationFieldPath(errors, values, opts)).toBe(
      'name',
    );
  });

  it('returns the first invalid AWS profile account id', () => {
    const values = awsValues({});
    const errors = {
      awsProfiles: [
        {
          accountId: { message: 'Required', type: 'too_small' },
        },
      ],
    } as FieldErrors<IntegrationFormValues>;

    expect(getFirstInvalidIntegrationFieldPath(errors, values, opts)).toBe(
      'awsProfiles.0.accountId',
    );
  });

  it('returns advanced HTTP fields after primary connection and auth fields', () => {
    const values = httpValues({});
    const errors = {
      caCertificate: { message: 'Invalid certificate', type: 'custom' },
    } as FieldErrors<IntegrationFormValues>;

    expect(getFirstInvalidIntegrationFieldPath(errors, values, opts)).toBe(
      'caCertificate',
    );
  });
});
