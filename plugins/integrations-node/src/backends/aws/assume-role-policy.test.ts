import { describe, expect, it } from 'vitest';
import {
  AWS_READ_ONLY_SESSION_POLICY_ARN,
  awsAssumeRolePolicyKey,
  createLegacyAwsAssumeRolePolicy,
  createMigratingAwsAssumeRolePolicy,
  createStrictAwsAssumeRolePolicy,
  deriveExternalId,
  withTrustSetupFrom,
  toSourceIdentity,
} from './assume-role-policy';

const SECRET = 'test-secret';

function context(overrides: Record<string, unknown> = {}) {
  return {
    accountId: '111122223333',
    roleArn: 'arn:aws:iam::111122223333:role/acme-roadie-read-only',
    integrationId: 'int-1',
    scopeId: 'acme',
    ...overrides,
  };
}

describe('deriveExternalId', () => {
  it('is stable for the same tenant and account', () => {
    expect(deriveExternalId(SECRET, 'acme')).toBe(
      deriveExternalId(SECRET, 'acme'),
    );
  });

  it('differs per tenant and per secret', () => {
    const base = deriveExternalId(SECRET, 'acme');
    expect(deriveExternalId(SECRET, 'other')).not.toBe(base);
    expect(deriveExternalId('other-secret', 'acme')).not.toBe(base);
  });

  it('produces a value AWS accepts', () => {
    const externalId = deriveExternalId(SECRET, 'acme');
    expect(externalId).toMatch(/^[a-f0-9]{40}$/);
  });
});

describe('toSourceIdentity', () => {
  it('strips characters AWS rejects', () => {
    expect(toSourceIdentity('acme/corp inc')).toBe('acme-corp-inc');
  });

  it('meets the 2-64 character bound', () => {
    expect(toSourceIdentity('a')).toBe('t-a');
    expect(toSourceIdentity('x'.repeat(100))).toHaveLength(64);
  });
});

describe('createLegacyAwsAssumeRolePolicy', () => {
  it('passes the configured external id through and sets nothing else', () => {
    const policy = createLegacyAwsAssumeRolePolicy();
    expect(
      policy.decide(context({ configuredExternalId: 'tenant-typed' })),
    ).toEqual({ externalId: 'tenant-typed' });
  });

  it('allows ambient credentials by default but can be locked down', () => {
    expect(createLegacyAwsAssumeRolePolicy().allowAmbientCredentials).toBe(
      true,
    );
    expect(
      createLegacyAwsAssumeRolePolicy({ allowAmbientCredentials: false })
        .allowAmbientCredentials,
    ).toBe(false);
  });
});

describe('createStrictAwsAssumeRolePolicy', () => {
  const policy = createStrictAwsAssumeRolePolicy({
    externalIdSecret: SECRET,
  });

  it('requires a secret', () => {
    expect(() =>
      createStrictAwsAssumeRolePolicy({ externalIdSecret: '' }),
    ).toThrow(/externalIdSecret/);
  });

  it('ignores the tenant-supplied external id and derives its own', () => {
    const decision = policy.decide(
      context({ configuredExternalId: 'attacker-chosen' }),
    );
    expect(decision.externalId).toBe(deriveExternalId(SECRET, 'acme'));
    expect(decision.externalId).not.toBe('attacker-chosen');
  });

  it('sets the source identity and a read-only session policy', () => {
    const decision = policy.decide(context());
    expect(decision.sourceIdentity).toBe('acme');
    expect(decision.sessionPolicyArns).toEqual([
      AWS_READ_ONLY_SESSION_POLICY_ARN,
    ]);
  });

  it('omits session policies when configured with none', () => {
    const noSessionPolicy = createStrictAwsAssumeRolePolicy({
      externalIdSecret: SECRET,
      sessionPolicyArns: [],
    });
    expect(noSessionPolicy.decide(context()).sessionPolicyArns).toBeUndefined();
  });

  it('fails closed when the request has no scope', () => {
    expect(() => policy.decide(context({ scopeId: undefined }))).toThrow(
      /has no scope/,
    );
  });

  it('never permits ambient credentials', () => {
    expect(policy.allowAmbientCredentials).toBe(false);
  });
});

describe('createMigratingAwsAssumeRolePolicy', () => {
  const strict = createStrictAwsAssumeRolePolicy({
    externalIdSecret: SECRET,
  });
  const legacy = createLegacyAwsAssumeRolePolicy({
    allowAmbientCredentials: false,
  });
  const policy = createMigratingAwsAssumeRolePolicy({
    strict,
    legacy,
    legacyIntegrationKeys: ['acme/int-legacy'],
  });

  it('exempts a listed integration', () => {
    const decision = policy.decide(
      context({
        integrationId: 'int-legacy',
        configuredExternalId: 'tenant-typed',
      }),
    );
    expect(decision).toEqual({ externalId: 'tenant-typed' });
  });

  it('applies strict rules to an unlisted integration', () => {
    const decision = policy.decide(
      context({ configuredExternalId: 'tenant-typed' }),
    );
    expect(decision.sourceIdentity).toBe('acme');
    expect(decision.externalId).not.toBe('tenant-typed');
  });

  it('scopes exemptions per tenant', () => {
    // Same integration id, different tenant: must not inherit the exemption.
    const decision = policy.decide(
      context({ integrationId: 'int-legacy', scopeId: 'other' }),
    );
    expect(decision.sourceIdentity).toBe('other');
  });

  it('does not let an exemption restore the ambient credential fallback', () => {
    expect(policy.allowAmbientCredentials).toBe(false);
  });
});

describe('awsAssumeRolePolicyKey', () => {
  it('qualifies the integration with its scope when present', () => {
    expect(awsAssumeRolePolicyKey('int-1', 'acme')).toBe('acme/int-1');
    expect(awsAssumeRolePolicyKey('int-1')).toBe('int-1');
  });
});

describe('describeTrustSetup', () => {
  const strict = createStrictAwsAssumeRolePolicy({
    externalIdSecret: SECRET,
    principalArn: 'arn:aws:iam::131774410247:role/prod0-roadie-next-backend',
  });

  it('reports the same external id that decide() sends', () => {
    // The whole point of deriving both from one object: a customer who copies
    // these values gets a trust policy the assume actually satisfies.
    const setup = strict.describeTrustSetup(context());
    const decision = strict.decide(context());
    expect(setup.externalId).toBe(decision.externalId);
    expect(setup.sourceIdentity).toBe(decision.sourceIdentity);
  });

  it('reports the principal and session policy', () => {
    const setup = strict.describeTrustSetup(context());
    expect(setup.principalArn).toBe(
      'arn:aws:iam::131774410247:role/prod0-roadie-next-backend',
    );
    expect(setup.sessionPolicyArns).toEqual([AWS_READ_ONLY_SESSION_POLICY_ARN]);
    expect(setup.strict).toBe(true);
  });

  it('reports the tenant-typed value under the legacy policy', () => {
    const legacy = createLegacyAwsAssumeRolePolicy({
      principalArn: 'arn:aws:iam::131774410247:role/prod0-roadie-next-backend',
    });
    const setup = legacy.describeTrustSetup(
      context({ configuredExternalId: 'tenant-typed' }),
    );
    expect(setup.strict).toBe(false);
    expect(setup.externalId).toBe('tenant-typed');
    expect(setup.sourceIdentity).toBeUndefined();
    expect(setup.sessionPolicyArns).toEqual([]);
  });

  it('follows the exemption routing', () => {
    const policy = createMigratingAwsAssumeRolePolicy({
      strict,
      legacy: createLegacyAwsAssumeRolePolicy({
        allowAmbientCredentials: false,
      }),
      legacyIntegrationKeys: ['acme/int-legacy'],
    });
    expect(
      policy.describeTrustSetup(
        context({
          integrationId: 'int-legacy',
          configuredExternalId: 'tenant-typed',
        }),
      ),
    ).toMatchObject({ strict: false, externalId: 'tenant-typed' });
    expect(policy.describeTrustSetup(context())).toMatchObject({
      strict: true,
    });
  });

  it('fails closed without a scope', () => {
    expect(() =>
      strict.describeTrustSetup(context({ scopeId: undefined })),
    ).toThrow(/has no scope/);
  });
});

describe('withTrustSetupFrom', () => {
  const strict = createStrictAwsAssumeRolePolicy({
    externalIdSecret: SECRET,
    principalArn: 'arn:aws:iam::131774410247:role/prod0-roadie-next-backend',
  });
  const policy = withTrustSetupFrom(createLegacyAwsAssumeRolePolicy(), strict);

  it('enforces the legacy values', () => {
    expect(
      policy.decide(context({ configuredExternalId: 'tenant-typed' })),
    ).toEqual({ externalId: 'tenant-typed' });
  });

  it('publishes the strict trust setup', () => {
    // What the customer's role must carry, regardless of what enforcement is
    // doing today.
    const setup = policy.describeTrustSetup(context());
    expect(setup.externalId).toBe(deriveExternalId(SECRET, 'acme'));
    expect(setup.sourceIdentity).toBe('acme');
    expect(setup.sessionPolicyArns).toEqual([AWS_READ_ONLY_SESSION_POLICY_ARN]);
  });
});
