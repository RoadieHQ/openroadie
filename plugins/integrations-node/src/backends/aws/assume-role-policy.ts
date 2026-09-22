import { createHmac } from 'node:crypto';

/**
 * The AWS-managed policy used as a session policy in strict mode. Session
 * policies intersect with the assumed role's own permissions, so this caps a
 * session at read-only no matter how broad the customer made their role.
 *
 * Cloud Control API dispatches to each resource type's own handler, which
 * needs that service's read actions (`s3:GetBucket*`, `rds:Describe*`, …), so
 * an enumerated inline policy would have to list every service we ingest.
 * ReadOnlyAccess is the maintenance-free equivalent.
 */
export const AWS_READ_ONLY_SESSION_POLICY_ARN =
  'arn:aws:iam::aws:policy/ReadOnlyAccess';

export interface AwsAssumeRoleContext {
  /** Account the target role lives in, as configured on the integration. */
  accountId: string;
  /** Fully-qualified ARN we are about to assume. */
  roleArn: string;
  integrationId: string;
  /** Tenant/scope making the request. Absent in single-tenant deployments. */
  scopeId?: string;
  /** External ID from the integration config, if the tenant set one. */
  configuredExternalId?: string;
}

export interface AwsAssumeRoleDecision {
  externalId?: string;
  sourceIdentity?: string;
  /** Managed policy ARNs to intersect the session with. */
  sessionPolicyArns?: string[];
}

/**
 * Context for describing a trust setup. Nothing in it depends on a particular
 * account, so the values are available before any account is configured.
 */
export type AwsTrustSetupContext = Omit<
  AwsAssumeRoleContext,
  'roleArn' | 'accountId'
>;

/**
 * Everything a customer needs to author the trust policy on their side. Derived
 * from the same policy object that performs the assume, so the values shown can
 * never drift from the values sent.
 */
export interface AwsTrustSetup {
  /** Whether identity pinning is enforced for this integration today. */
  strict: boolean;
  /** IAM principal the customer must trust. */
  principalArn?: string;
  externalId?: string;
  sourceIdentity?: string;
  sessionPolicyArns: string[];
}

export interface AwsAssumeRolePolicy {
  /**
   * Whether an integration with no configured role may fall back to the
   * process's ambient credentials. Legitimate for a self-hosted single-tenant
   * install running on an EC2 instance profile; never correct in a shared
   * multi-tenant deployment, where it would hand the host's own credentials to
   * whichever tenant saved the integration.
   */
  readonly allowAmbientCredentials: boolean;
  /** Extra AssumeRole parameters for this call. */
  decide(context: AwsAssumeRoleContext): AwsAssumeRoleDecision;
  /** The values a customer must put in their trust policy. */
  describeTrustSetup(context: AwsTrustSetupContext): AwsTrustSetup;
}

/**
 * Today's behaviour: pass the tenant-supplied external ID through untouched,
 * set no source identity, apply no session policy, and allow the ambient
 * credential fallback. This is the correct policy for OSS/self-hosted
 * openroadie, where there is one tenant and the operator owns both accounts.
 */
export function createLegacyAwsAssumeRolePolicy(
  options: {
    allowAmbientCredentials?: boolean;
    /** Shown to customers as the principal to trust. */
    principalArn?: string;
  } = {},
): AwsAssumeRolePolicy {
  return {
    allowAmbientCredentials: options.allowAmbientCredentials ?? true,
    decide(context) {
      return { externalId: context.configuredExternalId };
    },
    describeTrustSetup(context) {
      return {
        strict: false,
        principalArn: options.principalArn,
        // Whatever the tenant typed: under the legacy policy that is genuinely
        // the value we send.
        externalId: context.configuredExternalId,
        sessionPolicyArns: [],
      };
    },
  };
}

export interface StrictAwsAssumeRolePolicyOptions {
  /**
   * Secret used to derive per-tenant external IDs. Must not be reachable by
   * tenants — a tenant who can read it can compute another tenant's external
   * ID and defeat the whole control.
   */
  externalIdSecret: string;
  /** Defaults to ReadOnlyAccess; pass `[]` to disable session policies. */
  sessionPolicyArns?: string[];
  /**
   * The IAM principal customers must trust — this deployment's own role ARN.
   * Shown in the product so customers don't have to find it in the docs.
   */
  principalArn?: string;
}

/**
 * Derives the external ID a tenant's roles must carry. HMAC rather than the
 * legacy `base64(prefix-accountId)` scheme: that one is computable by anyone
 * who learns the prefix, which makes it useless as proof of tenancy.
 *
 * This is the control that separates tenants. Every tenant's requests leave as
 * the same IAM principal, so a customer's trust policy cannot tell them apart;
 * requiring a value only Roadie can compute for that tenant is what stops
 * tenant A naming tenant B's role in its own integration config.
 */
export function deriveExternalId(secret: string, scopeId: string): string {
  return createHmac('sha256', secret)
    .update(scopeId)
    .digest('hex')
    .slice(0, 40);
}

/**
 * Source identity must be 2-64 chars of alphanumerics plus `. , + = @ _ -`,
 * and may not start with `aws:`.
 */
export function toSourceIdentity(scopeId: string): string {
  const sanitized = scopeId.replace(/[^a-zA-Z0-9.,+=@_-]/g, '-').slice(0, 64);
  return sanitized.length >= 2 ? sanitized : `t-${sanitized}`;
}

export function createStrictAwsAssumeRolePolicy(
  options: StrictAwsAssumeRolePolicyOptions,
): AwsAssumeRolePolicy {
  if (!options.externalIdSecret) {
    throw new Error(
      'Strict AWS assume-role policy requires an externalIdSecret',
    );
  }

  const sessionPolicyArns = options.sessionPolicyArns ?? [
    AWS_READ_ONLY_SESSION_POLICY_ARN,
  ];

  // Strict mode is a per-tenant control, so a request that arrives without a
  // scope has no derivable identity. Fail closed rather than assuming with no
  // external ID, which is the exact hole strict mode closes.
  const requireScopeId = (context: AwsTrustSetupContext): string => {
    if (!context.scopeId) {
      throw new Error(
        'Refusing to assume an AWS role: strict assume-role policy is enabled but the request has no scope',
      );
    }
    return context.scopeId;
  };

  return {
    allowAmbientCredentials: false,

    decide(context) {
      const scopeId = requireScopeId(context);
      return {
        externalId: deriveExternalId(options.externalIdSecret, scopeId),
        sourceIdentity: toSourceIdentity(scopeId),
        ...(sessionPolicyArns.length > 0 && { sessionPolicyArns }),
      };
    },

    describeTrustSetup(context) {
      const scopeId = requireScopeId(context);
      return {
        strict: true,
        principalArn: options.principalArn,
        externalId: deriveExternalId(options.externalIdSecret, scopeId),
        sourceIdentity: toSourceIdentity(scopeId),
        sessionPolicyArns,
      };
    },
  };
}

export interface MigratingAwsAssumeRolePolicyOptions {
  strict: AwsAssumeRolePolicy;
  legacy: AwsAssumeRolePolicy;
  /**
   * Integrations still on the legacy policy, as `scopeId/integrationId` (or
   * bare `integrationId` for unscoped deployments). Every entry is an
   * integration whose customer has not yet updated their trust policy; the
   * list is the migration backlog and should end up empty.
   */
  legacyIntegrationKeys: Iterable<string>;
}

export function awsAssumeRolePolicyKey(
  integrationId: string,
  scopeId?: string,
): string {
  return scopeId ? `${scopeId}/${integrationId}` : integrationId;
}

/**
 * Routes each integration to the strict or legacy policy. Strict is the
 * default so a newly created integration is protected without anyone
 * remembering to opt in; exemptions are explicit and enumerated.
 *
 * The exemption list is deliberately server-side config rather than a field on
 * the integration: a tenant who could turn strict mode off on their own
 * integration could then assume any role that trusts the shared Roadie
 * principal without presenting an external ID.
 */
export function createMigratingAwsAssumeRolePolicy(
  options: MigratingAwsAssumeRolePolicyOptions,
): AwsAssumeRolePolicy {
  const legacyKeys = new Set(options.legacyIntegrationKeys);

  const select = (context: AwsTrustSetupContext): AwsAssumeRolePolicy =>
    legacyKeys.has(
      awsAssumeRolePolicyKey(context.integrationId, context.scopeId),
    )
      ? options.legacy
      : options.strict;

  return {
    // The permissive default would silently re-enable the ambient credential
    // fallback for exempted integrations, so take the stricter of the two.
    allowAmbientCredentials:
      options.strict.allowAmbientCredentials &&
      options.legacy.allowAmbientCredentials,
    decide(context) {
      return select(context).decide(context);
    },
    describeTrustSetup(context) {
      return select(context).describeTrustSetup(context);
    },
  };
}

/**
 * Enforces one policy while describing another.
 *
 * The trust setup shown to customers is always the strict one — those are the
 * values their role must carry. Enforcement stays separate because it is rolled
 * out per integration.
 */
export function withTrustSetupFrom(
  enforced: AwsAssumeRolePolicy,
  describer: AwsAssumeRolePolicy,
): AwsAssumeRolePolicy {
  return {
    allowAmbientCredentials: enforced.allowAmbientCredentials,
    decide(context) {
      return enforced.decide(context);
    },
    describeTrustSetup(context) {
      return describer.describeTrustSetup(context);
    },
  };
}
