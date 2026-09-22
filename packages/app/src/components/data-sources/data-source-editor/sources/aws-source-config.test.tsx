import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithQuery as render } from '../../../../test-utils';

import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AwsSourceConfig } from './aws-source-config';

describe('AwsSourceConfig', () => {
  it('supports manual AWS account entry when no profiles are configured', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <AwsSourceConfig
        config={{ mode: 'cloud-control' }}
        onChange={onChange}
        integration={
          {
            id: 'aws-1',
            name: 'AWS',
            slug: 'aws',
            host: '',
            backendType: 'aws',
            config: { profiles: {} },
          } as never
        }
      />,
    );

    const input = screen.getByPlaceholderText(
      'Type an account ID, then use space or comma',
    );
    await user.type(input, '123456789012{Enter}');

    expect(onChange).toHaveBeenCalledWith('accountIds', ['123456789012']);
  });

  it('shows profile names alongside account ids in configured account options', async () => {
    const user = userEvent.setup();

    render(
      <AwsSourceConfig
        config={{ mode: 'cloud-control', accountIds: ['123456789012'] }}
        onChange={vi.fn()}
        integration={
          {
            id: 'aws-1',
            name: 'AWS',
            slug: 'aws',
            host: '',
            backendType: 'aws',
            config: {
              profiles: {
                '123456789012': {
                  name: 'Production',
                  accountId: '123456789012',
                },
                '222222222222': {
                  name: 'Shared services',
                  accountId: '222222222222',
                },
              },
            },
          } as never
        }
      />,
    );

    expect(screen.getByText('Production (123456789012)')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove 123456789012' }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByPlaceholderText(
        'Select or type an account ID, then use space or comma',
      ),
    );

    expect(
      screen.getByRole('option', { name: 'Shared services (222222222222)' }),
    ).toBeInTheDocument();
  });

  it('uses the same account picker for service-api mode', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <AwsSourceConfig
        config={{ mode: 'service-api' }}
        onChange={onChange}
        integration={
          {
            id: 'aws-1',
            name: 'AWS',
            slug: 'aws',
            host: '',
            backendType: 'aws',
            config: { profiles: {} },
          } as never
        }
      />,
    );

    expect(screen.queryByLabelText('AWS Profile')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Region')).not.toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText(
        'Type an account ID, then use space or comma',
      ),
      '123456789012{Enter}',
    );

    expect(onChange).toHaveBeenCalledWith('accountIds', ['123456789012']);
  });

  it('shows template-specific copy for chained sources', () => {
    render(
      <AwsSourceConfig
        config={{ mode: 'cloud-control' }}
        onChange={vi.fn()}
        allowAccountTemplates
        integration={
          {
            id: 'aws-1',
            name: 'AWS',
            slug: 'aws',
            host: '',
            backendType: 'aws',
            config: { profiles: {} },
          } as never
        }
      />,
    );

    expect(
      screen.getByPlaceholderText(
        'Type an account ID, then use space or comma',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Template expressions are also supported/),
    ).toBeInTheDocument();
  });

  it('requires auth override for custom cloud-control accounts and opens advanced settings', () => {
    render(
      <AwsSourceConfig
        config={{ mode: 'cloud-control', accountIds: ['123456789012'] }}
        onChange={vi.fn()}
        integration={
          {
            id: 'aws-1',
            name: 'AWS',
            slug: 'aws',
            host: '',
            backendType: 'aws',
            config: { profiles: {} },
          } as never
        }
      />,
    );

    expect(
      screen.getByText(
        'Custom account IDs require a Role Name under Authentication Override.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Role Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Role Name')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(
      screen.getByText(
        'Enter a role name or ARN. It will be used for every account selected for this source, including any you typed in that are not in the integration.',
      ),
    ).toBeInTheDocument();
  });

  it('surfaces the selected profile region as the regions default and auth region placeholder', async () => {
    const user = userEvent.setup();

    render(
      <AwsSourceConfig
        config={{ mode: 'cloud-control', accountIds: ['123456789012'] }}
        onChange={vi.fn()}
        integration={
          {
            id: 'aws-1',
            name: 'AWS',
            slug: 'aws',
            host: '',
            backendType: 'aws',
            config: {
              profiles: {
                '123456789012': {
                  name: 'Prod',
                  accountId: '123456789012',
                  roleName: 'TestRole',
                  region: 'eu-west-1',
                },
              },
            },
          } as never
        }
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Advanced' }));

    expect(
      screen.getByPlaceholderText('Default: eu-west-1'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Auth Region')).toHaveAttribute(
      'placeholder',
      'eu-west-1',
    );
  });

  it('falls back to us-east-1 when the selected profile has no region', async () => {
    const user = userEvent.setup();

    render(
      <AwsSourceConfig
        config={{ mode: 'cloud-control', accountIds: ['123456789012'] }}
        onChange={vi.fn()}
        integration={
          {
            id: 'aws-1',
            name: 'AWS',
            slug: 'aws',
            host: '',
            backendType: 'aws',
            config: {
              profiles: {
                '123456789012': {
                  name: 'Prod',
                  accountId: '123456789012',
                  roleName: 'TestRole',
                },
              },
            },
          } as never
        }
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Advanced' }));

    expect(
      screen.getByPlaceholderText('Default: us-east-1'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Auth Region')).toHaveAttribute(
      'placeholder',
      'us-east-1',
    );
  });

  it('flags custom service-api accounts as invalid', () => {
    render(
      <AwsSourceConfig
        config={{ mode: 'service-api', accountIds: ['123456789012'] }}
        onChange={vi.fn()}
        integration={
          {
            id: 'aws-1',
            name: 'AWS',
            slug: 'aws',
            host: '',
            backendType: 'aws',
            config: { profiles: {} },
          } as never
        }
      />,
    );

    expect(
      screen.getByText(
        'Service API sources can only use configured AWS accounts from the integration.',
      ),
    ).toBeInTheDocument();
  });

  it('supports live select-all account selection when organizations are enabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const loadOrganizationAccounts = vi.fn().mockResolvedValue([
      {
        accountId: '123456789012',
        name: 'Production',
        region: 'eu-west-1',
        isManagementAccount: false,
        source: 'organizations',
        tags: {
          Environment: 'prod',
        },
      },
    ]);
    const integration = {
      id: 'aws-1',
      name: 'AWS',
      slug: 'aws',
      host: '',
      backendType: 'aws',
      config: {
        organizations: {
          enabled: true,
          managementAccount: {
            accountId: '999999999999',
          },
        },
      },
    } as never;

    const { rerender } = render(
      <AwsSourceConfig
        config={{ mode: 'cloud-control' }}
        onChange={onChange}
        loadOrganizationAccounts={loadOrganizationAccounts}
        integration={integration}
      />,
    );

    expect(await screen.findByText('Select all accounts')).toBeInTheDocument();

    await user.click(
      screen.getByRole('radio', { name: 'Select all accounts' }),
    );

    expect(onChange).toHaveBeenCalledWith('accountIds', undefined);
    expect(onChange).toHaveBeenCalledWith('accountSelection', {
      mode: 'all',
      excludedAccountIds: [],
      requiredTags: [],
      excludedTags: [],
    });

    rerender(
      <AwsSourceConfig
        config={{
          mode: 'cloud-control',
          accountSelection: {
            mode: 'all',
            excludedAccountIds: [],
            requiredTags: [],
            excludedTags: [],
          },
        }}
        onChange={onChange}
        loadOrganizationAccounts={loadOrganizationAccounts}
        integration={integration}
      />,
    );

    expect(await screen.findByText('1 matching account')).toBeInTheDocument();
  });

  it('rejects invalid manually entered excluded account IDs', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const loadOrganizationAccounts = vi.fn().mockResolvedValue([
      {
        accountId: '123456789012',
        name: 'Production',
        region: 'eu-west-1',
        isManagementAccount: false,
        source: 'organizations',
        tags: {},
      },
    ]);
    const integration = {
      id: 'aws-1',
      name: 'AWS',
      slug: 'aws',
      host: '',
      backendType: 'aws',
      config: {
        organizations: {
          enabled: true,
          managementAccount: {
            accountId: '999999999999',
          },
        },
      },
    } as never;

    render(
      <AwsSourceConfig
        config={{
          mode: 'cloud-control',
          accountSelection: {
            mode: 'all',
            excludedAccountIds: [],
            requiredTags: [],
            excludedTags: [],
          },
        }}
        onChange={onChange}
        loadOrganizationAccounts={loadOrganizationAccounts}
        integration={integration}
      />,
    );

    await user.click(
      await screen.findByRole('radio', { name: 'Select all accounts' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Exclusions & filtering' }),
    );

    const input = await screen.findByPlaceholderText(
      'Select or type an account ID, then use space or comma',
    );
    await user.type(input, '23423423423{Enter}');

    expect(
      screen.getByText(
        'Invalid account ID: 23423423423. Must be a 12-digit AWS account ID.',
      ),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalledWith('accountSelection', {
      mode: 'all',
      excludedAccountIds: ['23423423423'],
      requiredTags: [],
      excludedTags: [],
    });
  });

  it('shows select-all when only manual profiles are configured', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <AwsSourceConfig
        config={{ mode: 'cloud-control' }}
        onChange={onChange}
        integration={
          {
            id: 'aws-1',
            name: 'AWS',
            slug: 'aws',
            host: '',
            backendType: 'aws',
            config: {
              profiles: {
                '123456789012': {
                  name: 'Production',
                  accountId: '123456789012',
                },
              },
            },
          } as never
        }
      />,
    );

    expect(screen.getByText('Select all accounts')).toBeInTheDocument();
    await user.click(
      screen.getByRole('radio', { name: 'Select all accounts' }),
    );
    expect(onChange).toHaveBeenCalledWith('accountSelection', {
      mode: 'all',
      excludedAccountIds: [],
      requiredTags: [],
      excludedTags: [],
    });
  });

  it('explains configured-accounts sources instead of showing targeting fields', () => {
    render(
      <AwsSourceConfig
        config={{ mode: 'configured-accounts' }}
        onChange={vi.fn()}
        integration={
          {
            id: 'aws-1',
            name: 'AWS',
            slug: 'aws',
            host: '',
            backendType: 'aws',
            config: {
              profiles: {
                '123456789012': { accountId: '123456789012' },
              },
            },
          } as never
        }
      />,
    );

    expect(
      screen.getByText(
        /lists AWS accounts from the integration: manually configured profiles/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Select all accounts')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Resource Type')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('AWS Service')).not.toBeInTheDocument();
  });
});
