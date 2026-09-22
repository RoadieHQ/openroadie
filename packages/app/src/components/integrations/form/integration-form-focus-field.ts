import type { FieldErrors, Path } from 'react-hook-form';
import type { IntegrationFormValues } from './integration-schema';

function getErrorAtPath(
  errors: FieldErrors<IntegrationFormValues>,
  path: string,
): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (
      current &&
      typeof current === 'object' &&
      segment in (current as object)
    ) {
      return (current as Record<string, unknown>)[`${segment}`];
    }
    return undefined;
  }, errors);
}

function hasFieldError(
  errors: FieldErrors<IntegrationFormValues>,
  path: string,
): boolean {
  const node = getErrorAtPath(errors, path);
  return node !== undefined && node !== null;
}

export function integrationFormFocusFieldOrder(
  values: IntegrationFormValues,
  options: {
    isEdit: boolean;
    systemIntegration: boolean;
    readOnly: boolean;
  },
): string[] {
  const metadataReadOnly = options.readOnly || options.systemIntegration;
  const slugDisabled = options.isEdit || metadataReadOnly;
  const nameDisabled = options.readOnly;

  const paths: string[] = [];
  if (!nameDisabled) {
    paths.push('name');
  }
  if (!slugDisabled) {
    paths.push('slug');
  }

  if (values.backendType === 'http') {
    paths.push('host', 'graphqlPath', 'authType');
    const at = values.authType;
    if (at === 'header') {
      const rows = values.authHeaders?.length ?? 0;
      if (rows === 0) {
        paths.push('authHeaders');
      } else {
        for (let i = 0; i < rows; i += 1) {
          paths.push(`authHeaders.${i}.key`, `authHeaders.${i}.value`);
        }
      }
    } else if (at === 'basic') {
      paths.push('basicUsername', 'basicPassword');
    } else if (at === 'bearer-token') {
      paths.push('bearerToken');
    } else if (at === 'oauth2-client-credentials') {
      paths.push(
        'oauth2TokenUrl',
        'oauth2ClientId',
        'oauth2ClientSecret',
        'oauth2Audience',
        'oauth2Scope',
      );
    } else if (at === 'oauth2-jwt-bearer') {
      paths.push(
        'jwtIssuer',
        'jwtPrivateKey',
        'jwtTokenUrl',
        'jwtAudience',
        'jwtScope',
        'jwtSubject',
      );
    }
    paths.push(
      'requestsPerHour',
      'requestsPerSecond',
      'burstCapacity',
      'paginationDefault',
      'defaultHeaders',
      'caCertificate',
    );
  } else {
    const rows = values.awsProfiles?.length ?? 0;
    if (rows === 0) {
      paths.push('awsProfiles');
    } else {
      for (let i = 0; i < rows; i += 1) {
        paths.push(
          `awsProfiles.${i}.name`,
          `awsProfiles.${i}.accountId`,
          `awsProfiles.${i}.roleName`,
          `awsProfiles.${i}.externalId`,
          `awsProfiles.${i}.region`,
        );
      }
    }
    paths.push('requestsPerHour', 'requestsPerSecond', 'burstCapacity');
  }

  return paths;
}

export function getFirstInvalidIntegrationFieldPath(
  errors: FieldErrors<IntegrationFormValues>,
  values: IntegrationFormValues,
  options: {
    isEdit: boolean;
    systemIntegration: boolean;
    readOnly: boolean;
  },
): Path<IntegrationFormValues> | undefined {
  for (const path of integrationFormFocusFieldOrder(values, options)) {
    if (hasFieldError(errors, path)) {
      return path as Path<IntegrationFormValues>;
    }
  }
  return undefined;
}
