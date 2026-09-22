import {
  hasDynamicAwsAccountSelection,
  isAwsSourceConfigured,
} from './aws-source-configured';

describe('isAwsSourceConfigured', () => {
  const serviceApiConfig = {
    integrationId: 'int-aws',
    mode: 'service-api',
    accountIds: ['123456789012'],
    service: 's3',
    operation: 'ListBuckets',
    path: '/',
    arrayExpression: 'Buckets',
  };

  const cloudControlConfig = {
    integrationId: 'int-aws',
    accountIds: ['123456789012'],
    resourceType: 'AWS::S3::Bucket',
  };

  describe('service-api mode', () => {
    it('is configured with service, operation, path and arrayExpression but NO resourceType (sc-33960)', () => {
      expect(isAwsSourceConfigured(serviceApiConfig)).toBe(true);
    });

    it('is not configured when the operation is missing', () => {
      expect(
        isAwsSourceConfigured({ ...serviceApiConfig, operation: undefined }),
      ).toBe(false);
    });

    it('is not configured when the service is missing', () => {
      expect(
        isAwsSourceConfigured({ ...serviceApiConfig, service: undefined }),
      ).toBe(false);
    });

    it('uses operation metadata when request details are omitted', () => {
      expect(
        isAwsSourceConfigured({
          ...serviceApiConfig,
          path: undefined,
          arrayExpression: undefined,
        }),
      ).toBe(true);
    });

    it('is not configured without account targets', () => {
      expect(
        isAwsSourceConfigured({ ...serviceApiConfig, accountIds: [] }),
      ).toBe(false);
    });

    it('accepts dynamic (all-accounts) selection instead of explicit account ids', () => {
      expect(
        isAwsSourceConfigured({
          ...serviceApiConfig,
          accountIds: [],
          accountSelection: { mode: 'all' },
        }),
      ).toBe(true);
    });
  });

  describe('cloud-control mode', () => {
    it('is configured with account targets and a resource type', () => {
      expect(isAwsSourceConfigured(cloudControlConfig)).toBe(true);
    });

    it('is not configured when the resource type is missing', () => {
      expect(
        isAwsSourceConfigured({
          ...cloudControlConfig,
          resourceType: undefined,
        }),
      ).toBe(false);
    });

    it('is not configured without account targets', () => {
      expect(
        isAwsSourceConfigured({ ...cloudControlConfig, accountIds: [] }),
      ).toBe(false);
    });

    it('is not configured when the resource model JSON is invalid', () => {
      expect(
        isAwsSourceConfigured({
          ...cloudControlConfig,
          resourceModel: '{not json',
        }),
      ).toBe(false);
    });
  });

  describe('configured-accounts mode', () => {
    it('is configured without account targets, service, or resource type', () => {
      expect(
        isAwsSourceConfigured({
          integrationId: 'int-aws',
          mode: 'configured-accounts',
        }),
      ).toBe(true);
    });
  });

  describe('invalid account ids', () => {
    it('is not configured when an account id is invalid', () => {
      expect(
        isAwsSourceConfigured({
          ...cloudControlConfig,
          accountIds: ['not-an-account'],
        }),
      ).toBe(false);
    });

    it('is not configured when an excluded account id is invalid', () => {
      expect(
        isAwsSourceConfigured({
          ...cloudControlConfig,
          accountSelection: {
            mode: 'all',
            excludedAccountIds: ['not-an-account'],
          },
        }),
      ).toBe(false);
    });
  });
});

describe('hasDynamicAwsAccountSelection', () => {
  it('detects the all-accounts selection mode', () => {
    expect(
      hasDynamicAwsAccountSelection({ accountSelection: { mode: 'all' } }),
    ).toBe(true);
  });

  it('rejects other selection shapes', () => {
    expect(hasDynamicAwsAccountSelection({})).toBe(false);
    expect(
      hasDynamicAwsAccountSelection({ accountSelection: { mode: 'manual' } }),
    ).toBe(false);
    expect(hasDynamicAwsAccountSelection({ accountSelection: null })).toBe(
      false,
    );
  });
});
