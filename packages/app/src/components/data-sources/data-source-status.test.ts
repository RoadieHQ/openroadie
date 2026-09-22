import {
  getDataSourceOverviewStatus,
  getDataSourceSetupStatus,
} from './data-source-status';
import type { DataSourceItem, IntegrationInfo } from './types';
import type { IntegrationSecretSummary } from '../integrations/use-integration-secret-status';

function makeDataSource(
  overrides: Partial<DataSourceItem> = {},
): DataSourceItem {
  return {
    id: 'ds-1',
    name: 'Test source',
    enabled: false,
    logoUrl: '',
    ...overrides,
  } as DataSourceItem;
}

function makeIntegration(
  overrides: Partial<IntegrationInfo> = {},
): IntegrationInfo {
  return {
    id: 'int-1',
    type: 'github',
    label: 'GitHub',
    icon: '',
    color: '',
    logoUrl: '',
    readyForCurrentScope: true,
    ...overrides,
  };
}

function summaryMap(
  summary?: Partial<IntegrationSecretSummary>,
): Map<string, IntegrationSecretSummary> {
  if (!summary) return new Map();
  return new Map([
    [
      'int-1',
      {
        requiredSecretRefs: [],
        missingSecretRefs: [],
        hasRequiredConfig: true,
        configured: true,
        ...summary,
      },
    ],
  ]);
}

// Setup status is the single source of truth for the overview Setup column and
// the detail drawer so the taxonomy, tone, and tooltip reason can't drift.
describe('getDataSourceSetupStatus', () => {
  it('reports a completed dry-run as ready to enable', () => {
    const ds = makeDataSource({
      integrationId: 'int-1',
      integration: makeIntegration(),
      isSourceConfigured: true,
      execution: { isDryRun: true, status: 'completed' },
    });

    expect(getDataSourceSetupStatus(ds, summaryMap({}), false)).toEqual({
      tone: 'muted',
      label: 'Ready',
      tooltip: 'Validated — ready to enable',
    });
  });

  it('does not tell an enabled source that it is ready to enable', () => {
    const ds = makeDataSource({
      enabled: true,
      integrationId: 'int-1',
      integration: makeIntegration(),
      isSourceConfigured: true,
      execution: { isDryRun: true, status: 'completed' },
    });

    expect(getDataSourceSetupStatus(ds, summaryMap({}), false)).toEqual({
      tone: 'muted',
      label: 'Ready',
      tooltip: 'Validated',
    });
  });

  it('does not let a completed dry-run hide missing setup', () => {
    const ds = makeDataSource({
      integrationId: 'int-1',
      integration: makeIntegration(),
      isSourceConfigured: false,
      execution: { isDryRun: true, status: 'completed' },
    });

    expect(getDataSourceSetupStatus(ds, summaryMap({}), false)).toEqual({
      tone: 'warning',
      label: 'Needs setup',
      tooltip: 'Source endpoint not configured',
    });
  });

  it('does not let a completed dry-run hide missing AWS account targets', () => {
    const ds = makeDataSource({
      integrationId: 'int-1',
      integration: makeIntegration({
        backendType: 'aws',
        config: {},
      }),
      sourceConfig: {
        accountSelection: { mode: 'all' },
        service: 'ec2',
        operation: 'DescribeInstances',
      },
      isSourceConfigured: true,
      execution: { isDryRun: true, status: 'completed' },
    });

    expect(getDataSourceSetupStatus(ds, summaryMap({}), false)).toEqual({
      tone: 'warning',
      label: 'Needs integration setup',
      tooltip: 'Add at least one AWS account or enable Organizations',
      unreadyIntegrationId: 'int-1',
    });
  });

  it('keeps dynamic AWS sources ready when only manual profiles are configured', () => {
    const ds = makeDataSource({
      integrationId: 'int-1',
      integration: makeIntegration({
        backendType: 'aws',
        config: {
          profiles: {
            '123456789012': { accountId: '123456789012' },
          },
        },
      }),
      sourceConfig: {
        accountSelection: { mode: 'all' },
        service: 'ec2',
        operation: 'DescribeInstances',
      },
      isSourceConfigured: true,
    });

    expect(getDataSourceSetupStatus(ds, summaryMap({}), false)).toEqual({
      tone: 'success',
      label: 'Ready',
      tooltip: 'Ready',
    });
  });

  it('keeps dynamic AWS sources ready when Organizations is enabled', () => {
    const ds = makeDataSource({
      integrationId: 'int-1',
      integration: makeIntegration({
        backendType: 'aws',
        config: {
          organizations: {
            enabled: true,
            managementAccount: { accountId: '123456789012' },
          },
        },
      }),
      sourceConfig: { accountSelection: { mode: 'all' } },
      isSourceConfigured: true,
    });

    expect(getDataSourceSetupStatus(ds, summaryMap({}), false)).toEqual({
      tone: 'success',
      label: 'Ready',
      tooltip: 'Ready',
    });
  });

  it('keeps explicit-account AWS sources ready without Organizations', () => {
    const ds = makeDataSource({
      integrationId: 'int-1',
      integration: makeIntegration({
        backendType: 'aws',
        config: {
          profiles: {
            '123456789012': { accountId: '123456789012' },
          },
        },
      }),
      sourceConfig: { accountIds: ['123456789012'] },
      isSourceConfigured: true,
    });

    expect(getDataSourceSetupStatus(ds, summaryMap({}), false)).toEqual({
      tone: 'success',
      label: 'Ready',
      tooltip: 'Ready',
    });
  });

  it('needs setup with a reason when no integration is selected', () => {
    const ds = makeDataSource();

    expect(getDataSourceSetupStatus(ds, new Map(), false)).toEqual({
      tone: 'warning',
      label: 'Needs setup',
      tooltip: 'No integration selected',
    });
  });

  it('needs integration setup when secrets are missing', () => {
    const ds = makeDataSource({
      integrationId: 'int-1',
      integration: makeIntegration(),
    });

    expect(
      getDataSourceSetupStatus(
        ds,
        summaryMap({
          requiredSecretRefs: ['GITHUB_TOKEN'],
          missingSecretRefs: ['GITHUB_TOKEN'],
          configured: false,
        }),
        false,
      ),
    ).toEqual({
      tone: 'warning',
      label: 'Needs integration setup',
      tooltip: '1 required secret missing',
      unreadyIntegrationId: 'int-1',
    });
  });

  it('needs setup when the source endpoint itself is unconfigured', () => {
    const ds = makeDataSource({
      enabled: true,
      integrationId: 'int-1',
      integration: makeIntegration(),
      isSourceConfigured: false,
    });

    expect(getDataSourceSetupStatus(ds, summaryMap({}), false)).toEqual({
      tone: 'warning',
      label: 'Needs setup',
      tooltip: 'Source endpoint not configured',
    });
  });

  it('is Ready when configured, even if disabled', () => {
    const ds = makeDataSource({
      enabled: false,
      integrationId: 'int-1',
      integration: makeIntegration(),
      isSourceConfigured: true,
    });

    expect(getDataSourceSetupStatus(ds, summaryMap({}), false)).toEqual({
      tone: 'success',
      label: 'Ready',
      tooltip: 'Ready',
    });
  });

  it('is Ready when configured and enabled', () => {
    const ds = makeDataSource({
      enabled: true,
      integrationId: 'int-1',
      integration: makeIntegration(),
      isSourceConfigured: true,
    });

    expect(getDataSourceSetupStatus(ds, summaryMap({}), false)).toEqual({
      tone: 'success',
      label: 'Ready',
      tooltip: 'Ready',
    });
  });

  it('defers status while integration secret summaries are loading', () => {
    const ds = makeDataSource({
      enabled: true,
      integrationId: 'int-1',
      integration: makeIntegration(),
      isSourceConfigured: true,
    });

    expect(getDataSourceSetupStatus(ds, summaryMap({}), true)).toEqual({
      tone: 'muted',
      label: '',
      pending: true,
    });
  });

  it('defers status when only integrations[] is populated (no legacy integration)', () => {
    const chained = makeIntegration({ id: 'int-2', label: 'AWS' });
    const ds = makeDataSource({
      enabled: true,
      integrations: [chained],
      isSourceConfigured: true,
    });

    expect(getDataSourceSetupStatus(ds, new Map(), true)).toEqual({
      tone: 'muted',
      label: '',
      pending: true,
    });
  });

  it('still surfaces source-endpoint gaps while secrets are loading', () => {
    const ds = makeDataSource({
      enabled: true,
      integrationId: 'int-1',
      integration: makeIntegration(),
      isSourceConfigured: false,
    });

    expect(getDataSourceSetupStatus(ds, summaryMap({}), true)).toEqual({
      tone: 'warning',
      label: 'Needs setup',
      tooltip: 'Source endpoint not configured',
    });
  });
});

describe('getDataSourceOverviewStatus', () => {
  it('shows enabled when a configured source is enabled', () => {
    const ds = makeDataSource({
      enabled: true,
      integrationId: 'int-1',
      integration: makeIntegration(),
      isSourceConfigured: true,
    });

    expect(getDataSourceOverviewStatus(ds, summaryMap({}), false)).toEqual({
      tone: 'success',
      label: 'Enabled',
      tooltip: 'Enabled',
    });
  });

  it('shows disabled when a configured source is disabled', () => {
    const ds = makeDataSource({
      enabled: false,
      integrationId: 'int-1',
      integration: makeIntegration(),
      isSourceConfigured: true,
    });

    expect(getDataSourceOverviewStatus(ds, summaryMap({}), false)).toEqual({
      tone: 'muted',
      label: 'Disabled',
      tooltip: 'Configured and ready to enable',
    });
  });

  it('keeps setup problems ahead of lifecycle state', () => {
    const ds = makeDataSource({
      enabled: false,
      integrationId: 'int-1',
      integration: makeIntegration(),
      isSourceConfigured: false,
    });

    expect(getDataSourceOverviewStatus(ds, summaryMap({}), false)).toEqual({
      tone: 'warning',
      label: 'Needs setup',
      tooltip: 'Source endpoint not configured',
    });
  });
});
