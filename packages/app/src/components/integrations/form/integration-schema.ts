import { z } from 'zod';

const REQUIRED_MESSAGE = 'Required';
const AWS_ACCOUNT_ID_PATTERN = /^\d{12}$/;
const AWS_ACCOUNT_ID_MESSAGE = 'Must be a 12-digit AWS account ID';
const LEGACY_CA_CERT_SECRET_REF_MESSAGE =
  'Secret references are no longer supported for CA certificates. Paste the PEM certificate directly.';
const LEGACY_SECRET_REFERENCE_PATTERN = /^\$\{[^}]+\}$/;
const INVALID_URL_MESSAGE = 'Enter a valid URL';
const INVALID_CA_CERTIFICATE_MESSAGE =
  'Enter a PEM certificate with BEGIN CERTIFICATE and END CERTIFICATE markers';

const headerEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
});

const authHeaderEntrySchema = z.object({
  key: z.string(),
  prefix: z.string().optional().default(''),
  value: z.string(),
});

const nextLinkConditionSchema = z
  .object({
    param: z.string(),
    equals: z.string().optional(),
    notEquals: z.string().optional(),
  })
  .refine(
    value => value.equals !== undefined || value.notEquals !== undefined,
    {
      message: 'Provide a value for the next-link condition',
    },
  );

const paginationDefaultSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z
    .object({
      type: z.literal('cursor'),
      cursorParam: z.string(),
      nextCursorExpression: z.string(),
      paramLocation: z.enum(['query', 'body']).optional(),
      bodyParamsPath: z.string().min(1).optional(),
    })
    .refine(
      value =>
        value.bodyParamsPath === undefined || value.paramLocation === 'body',
      { message: 'bodyParamsPath requires paramLocation "body"' },
    ),
  z.object({
    type: z.literal('page'),
    pageParam: z.string(),
    perPageParam: z.string(),
    perPage: z.number(),
    startPage: z.number().optional(),
  }),
  z
    .object({
      type: z.literal('offset'),
      offsetParam: z.string(),
      limitParam: z.string(),
      limit: z.number(),
      paramLocation: z.enum(['query', 'body']).optional(),
      bodyParamsPath: z.string().min(1).optional(),
      totalExpression: z.string().optional(),
    })
    .refine(
      value =>
        value.bodyParamsPath === undefined || value.paramLocation === 'body',
      { message: 'bodyParamsPath requires paramLocation "body"' },
    ),
  z.object({
    type: z.literal('link'),
    perPageParam: z.string().optional(),
    perPage: z.number().optional(),
    nextRequestMethod: z.enum(['GET', 'POST']).optional(),
    nextLinkCondition: nextLinkConditionSchema.optional(),
  }),
  z.object({
    type: z.literal('body-link'),
    nextLinkExpression: z.string(),
    perPageParam: z.string().optional(),
    perPage: z.number().optional(),
    nextRequestMethod: z.enum(['GET', 'POST']).optional(),
  }),
  z.object({
    type: z.literal('graphql-cursor'),
    cursorVariable: z.string(),
    nextCursorExpression: z.string(),
    hasNextPageExpression: z.string().optional(),
  }),
]);

const awsAccountIdSchema = z
  .string()
  .trim()
  .min(1, REQUIRED_MESSAGE)
  .regex(AWS_ACCOUNT_ID_PATTERN, AWS_ACCOUNT_ID_MESSAGE);

const awsProfileEntrySchema = z.object({
  name: z.string().trim().optional().default(''),
  accountId: awsAccountIdSchema,
  roleName: z.string().trim().optional().default(''),
  externalId: z.string().trim().optional().default(''),
  region: z.string().trim().optional().default(''),
});

const awsTagEntrySchema = z.object({
  key: z.string().trim().optional().default(''),
  value: z.string().trim().optional().default(''),
});

const awsOrganizationsSchema = z
  .object({
    enabled: z.boolean().default(false),
    managementAccountId: z.string().trim().optional().default(''),
    managementRoleName: z.string().trim().optional().default(''),
    managementExternalId: z.string().trim().optional().default(''),
    managementRegion: z.string().trim().optional().default(''),
    defaultRoleName: z.string().trim().optional().default(''),
    memberExternalIdMode: z.enum(['static', 'prefix']).default('static'),
    defaultExternalId: z.string().trim().optional().default(''),
    defaultExternalIdPrefix: z.string().trim().optional().default(''),
    defaultRegion: z.string().trim().optional().default(''),
    excludeManagementAccount: z.boolean().default(true),
    excludedAccountIds: z.array(z.string().trim()).default([]),
    requiredTags: z.array(awsTagEntrySchema).default([]),
    excludedTags: z.array(awsTagEntrySchema).default([]),
  })
  .superRefine((data, ctx) => {
    if (
      data.managementAccountId.length > 0 &&
      !AWS_ACCOUNT_ID_PATTERN.test(data.managementAccountId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: AWS_ACCOUNT_ID_MESSAGE,
        path: ['managementAccountId'],
      });
    }

    const invalidExcludedIds = data.excludedAccountIds.filter(
      id => !AWS_ACCOUNT_ID_PATTERN.test(id),
    );
    if (invalidExcludedIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid account ${invalidExcludedIds.length === 1 ? 'ID' : 'IDs'}: ${invalidExcludedIds.join(', ')}. ${AWS_ACCOUNT_ID_MESSAGE}.`,
        path: ['excludedAccountIds'],
      });
    }
  });

const optionalNumericString = z
  .string()
  .trim()
  .optional()
  .default('')
  .refine(v => v === '' || (Number.isFinite(Number(v)) && Number(v) > 0), {
    message: 'Enter a positive number',
  });

const baseFields = {
  name: z.string().min(1, REQUIRED_MESSAGE),
  slug: z
    .string()
    .min(1, REQUIRED_MESSAGE)
    .regex(/^[a-z0-9-]+$/, 'Lowercase alphanumeric with hyphens'),
  type: z.string(),
  logoSlug: z.string().optional().default(''),
  requestsPerHour: optionalNumericString,
  requestsPerSecond: optionalNumericString,
  burstCapacity: optionalNumericString,
};

function isLoopbackHttpHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

function normalizeIntegrationHost(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('://')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'https:') {
      return true;
    }
    return url.protocol === 'http:' && isLoopbackHttpHost(url.hostname);
  } catch {
    return false;
  }
}

function isValidOptionalCaCertificate(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  return (
    trimmed.includes('-----BEGIN CERTIFICATE-----') &&
    trimmed.includes('-----END CERTIFICATE-----')
  );
}

function createIntegrationHostSchema(existingIntegrationHost?: string) {
  return z
    .string()
    .trim()
    .min(1, REQUIRED_MESSAGE)
    .refine(
      val => {
        if (existingIntegrationHost && val === existingIntegrationHost) {
          return true;
        }
        try {
          const url = new URL(normalizeIntegrationHost(val));
          if (url.protocol === 'https:') {
            return true;
          }
          if (url.protocol === 'http:' && isLoopbackHttpHost(url.hostname)) {
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },
      {
        message:
          'Enter a valid URL. https:// is added automatically when omitted (http:// is allowed only for localhost). For example https://api.example.com',
      },
    );
}

function createHttpSchema(host: z.ZodType<string, string>) {
  return z
    .object({
      ...baseFields,
      backendType: z.literal('http'),
      host,
      authType: z.enum([
        'header',
        'basic',
        'bearer-token',
        'oauth2-client-credentials',
        'oauth2-jwt-bearer',
        'none',
      ]),
      authHeaders: z.array(authHeaderEntrySchema).default([]),
      basicUsername: z.string().optional().default(''),
      basicPassword: z.string().optional().default(''),
      bearerToken: z.string().optional().default(''),
      oauth2ClientId: z.string().optional().default(''),
      oauth2ClientSecret: z.string().optional().default(''),
      oauth2TokenUrl: z.string().optional().default(''),
      oauth2Audience: z.string().optional().default(''),
      oauth2Scope: z.string().optional().default(''),
      jwtIssuer: z.string().optional().default(''),
      jwtPrivateKey: z.string().optional().default(''),
      jwtTokenUrl: z.string().optional().default(''),
      jwtAudience: z.string().optional().default(''),
      jwtScope: z.string().optional().default(''),
      jwtSubject: z.string().optional().default(''),
      defaultHeaders: z.array(headerEntrySchema).default([]),
      caCertificate: z.string().optional().default(''),
      graphqlPath: z.string().optional().default(''),
      paginationDefault: paginationDefaultSchema.optional(),
    })
    .superRefine((data, ctx) => {
      if (data.authType === 'header') {
        if (data.authHeaders.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'At least one header is required',
            path: ['authHeaders'],
          });
        }
        data.authHeaders.forEach((h, i) => {
          if (!h.key.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: REQUIRED_MESSAGE,
              path: ['authHeaders', i, 'key'],
            });
          }
          if (!h.value.trim()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: REQUIRED_MESSAGE,
              path: ['authHeaders', i, 'value'],
            });
          }
        });
      }

      if (data.authType === 'basic') {
        if (!data.basicPassword?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: REQUIRED_MESSAGE,
            path: ['basicPassword'],
          });
        }
      }

      if (data.authType === 'bearer-token') {
        if (!data.bearerToken?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: REQUIRED_MESSAGE,
            path: ['bearerToken'],
          });
        }
      }

      if (data.authType === 'oauth2-client-credentials') {
        if (!data.oauth2TokenUrl?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: REQUIRED_MESSAGE,
            path: ['oauth2TokenUrl'],
          });
        } else if (!isValidHttpUrl(data.oauth2TokenUrl)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: INVALID_URL_MESSAGE,
            path: ['oauth2TokenUrl'],
          });
        }
        if (!data.oauth2ClientId?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: REQUIRED_MESSAGE,
            path: ['oauth2ClientId'],
          });
        }
        if (!data.oauth2ClientSecret?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: REQUIRED_MESSAGE,
            path: ['oauth2ClientSecret'],
          });
        }
        const hasOauth2Audience = Boolean(data.oauth2Audience?.trim());
        const hasOauth2Scope = Boolean(data.oauth2Scope?.trim());
        if (!hasOauth2Audience && !hasOauth2Scope) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Provide a scope or audience',
            path: ['oauth2Audience'],
          });
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Provide a scope or audience',
            path: ['oauth2Scope'],
          });
        }
        if (hasOauth2Audience && hasOauth2Scope) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Use either scope or audience',
            path: ['oauth2Audience'],
          });
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Use either scope or audience',
            path: ['oauth2Scope'],
          });
        }
      }

      if (data.authType === 'oauth2-jwt-bearer') {
        if (!data.jwtIssuer?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: REQUIRED_MESSAGE,
            path: ['jwtIssuer'],
          });
        }
        if (!data.jwtPrivateKey?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: REQUIRED_MESSAGE,
            path: ['jwtPrivateKey'],
          });
        }
        if (!data.jwtTokenUrl?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: REQUIRED_MESSAGE,
            path: ['jwtTokenUrl'],
          });
        } else if (!isValidHttpUrl(data.jwtTokenUrl)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: INVALID_URL_MESSAGE,
            path: ['jwtTokenUrl'],
          });
        }
      }

      if (LEGACY_SECRET_REFERENCE_PATTERN.test(data.caCertificate.trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: LEGACY_CA_CERT_SECRET_REF_MESSAGE,
          path: ['caCertificate'],
        });
      } else if (!isValidOptionalCaCertificate(data.caCertificate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: INVALID_CA_CERTIFICATE_MESSAGE,
          path: ['caCertificate'],
        });
      }
    });
}

const httpSchema = createHttpSchema(createIntegrationHostSchema());

const awsSchema = z
  .object({
    ...baseFields,
    backendType: z.literal('aws'),
    host: z.string().optional().default(''),
    authType: z.enum(['header', 'none']).optional().default('none'),
    authHeaders: z.array(authHeaderEntrySchema).optional().default([]),
    basicUsername: z.string().optional().default(''),
    basicPassword: z.string().optional().default(''),
    bearerToken: z.string().optional().default(''),
    oauth2ClientId: z.string().optional().default(''),
    oauth2ClientSecret: z.string().optional().default(''),
    oauth2TokenUrl: z.string().optional().default(''),
    oauth2Audience: z.string().optional().default(''),
    oauth2Scope: z.string().optional().default(''),
    jwtIssuer: z.string().optional().default(''),
    jwtPrivateKey: z.string().optional().default(''),
    jwtTokenUrl: z.string().optional().default(''),
    jwtAudience: z.string().optional().default(''),
    jwtScope: z.string().optional().default(''),
    jwtSubject: z.string().optional().default(''),
    defaultHeaders: z.array(headerEntrySchema).optional().default([]),
    caCertificate: z.string().optional().default(''),
    awsProfiles: z.array(awsProfileEntrySchema).default([]),
    awsOrganizations: awsOrganizationsSchema.default({
      enabled: false,
      managementAccountId: '',
      managementRoleName: '',
      managementExternalId: '',
      managementRegion: '',
      defaultRoleName: '',
      memberExternalIdMode: 'static',
      defaultExternalId: '',
      defaultExternalIdPrefix: '',
      defaultRegion: '',
      excludeManagementAccount: true,
      excludedAccountIds: [],
      requiredTags: [],
      excludedTags: [],
    }),
  })
  .superRefine((data, ctx) => {
    if (LEGACY_SECRET_REFERENCE_PATTERN.test(data.caCertificate.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: LEGACY_CA_CERT_SECRET_REF_MESSAGE,
        path: ['caCertificate'],
      });
    } else if (!isValidOptionalCaCertificate(data.caCertificate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: INVALID_CA_CERTIFICATE_MESSAGE,
        path: ['caCertificate'],
      });
    }

    const seenAccountIds = new Map<string, number>();
    const flaggedDuplicateAccountIds = new Set<string>();
    data.awsProfiles.forEach((profile, index) => {
      const previousIndex = seenAccountIds.get(profile.accountId);
      if (previousIndex !== undefined) {
        if (!flaggedDuplicateAccountIds.has(profile.accountId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Account IDs must be unique',
            path: ['awsProfiles', previousIndex, 'accountId'],
          });
          flaggedDuplicateAccountIds.add(profile.accountId);
        }
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Account IDs must be unique',
          path: ['awsProfiles', index, 'accountId'],
        });
        return;
      }
      seenAccountIds.set(profile.accountId, index);
    });

    if (!data.awsOrganizations.enabled && data.awsProfiles.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Add at least one AWS account or enable AWS Organizations',
        path: ['awsProfiles'],
      });
    }

    if (
      data.awsOrganizations.enabled &&
      !data.awsOrganizations.managementAccountId.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: REQUIRED_MESSAGE,
        path: ['awsOrganizations', 'managementAccountId'],
      });
    }

    for (const [field, entries] of [
      ['requiredTags', data.awsOrganizations.requiredTags] as const,
      ['excludedTags', data.awsOrganizations.excludedTags] as const,
    ]) {
      entries.forEach((entry, index) => {
        const hasKey = entry.key.trim().length > 0;
        const hasValue = entry.value.trim().length > 0;

        if (hasKey && !hasValue) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: REQUIRED_MESSAGE,
            path: ['awsOrganizations', field, index, 'value'],
          });
        }

        if (!hasKey && hasValue) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: REQUIRED_MESSAGE,
            path: ['awsOrganizations', field, index, 'key'],
          });
        }
      });
    }
  });

export function createIntegrationSchema(options?: {
  existingIntegrationHost?: string;
}) {
  return z.discriminatedUnion('backendType', [
    options?.existingIntegrationHost
      ? createHttpSchema(
          createIntegrationHostSchema(options.existingIntegrationHost),
        )
      : httpSchema,
    awsSchema,
  ]);
}

export const integrationSchema = createIntegrationSchema();

export { normalizeIntegrationHost };

// The form holds the schema *input* (pre-`.default()`), which is what RHF's
// `Control`/`UseFormReturn` are keyed on. `handleSubmit` yields the *output*
// (all defaults applied) — that's `IntegrationFormSubmitValues`.
export type IntegrationFormValues = z.input<typeof integrationSchema>;
export type IntegrationFormSubmitValues = z.output<typeof integrationSchema>;
