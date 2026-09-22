import React from 'react';
import { screen } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { Form } from '@roadiehq/ui/form';
import { renderWithQuery as render } from '../../../test-utils';
import { AwsConfigFields } from './aws-config-fields';
import type { IntegrationFormValues } from './integration-schema';

const getAwsTrustSetup = vi.fn();

vi.mock('../../../api', () => ({
  useWorkflows: () => ({ integrations: { getAwsTrustSetup } }),
}));

function Harness({ integrationId }: { integrationId?: string }) {
  const form = useForm<IntegrationFormValues>({
    defaultValues: {
      backendType: 'aws',
      name: 'Test AWS',
      slug: 'test-aws',
      type: 'aws',
      awsProfiles: [
        {
          name: 'Production',
          accountId: '123456789012',
          roleName: 'my-role',
          externalId: 'typed-value',
          region: 'eu-west-1',
        },
      ],
    },
  });
  return (
    <Form {...form}>
      <AwsConfigFields control={form.control} integrationId={integrationId} />
    </Form>
  );
}

describe('AwsConfigFields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the External ID field editable under the legacy policy', async () => {
    getAwsTrustSetup.mockResolvedValue({
      strict: false,
      externalId: 'typed-value',
      sessionPolicyArns: [],
    });
    render(<Harness integrationId="int-1" />);

    const input = await screen.findByLabelText('External ID');
    expect(input).toBeEnabled();
    expect(
      screen.getByText('Used for secure cross-account role assumption'),
    ).toBeTruthy();
  });

  it('disables the External ID field and explains it is ignored under strict mode', async () => {
    getAwsTrustSetup.mockResolvedValue({
      strict: true,
      externalId: 'a1b2c3',
      sourceIdentity: 'acme',
      sessionPolicyArns: [],
    });
    render(<Harness integrationId="int-1" />);

    await screen.findByText(
      /strict mode derives and enforces its own external id/i,
    );
    expect(screen.getByLabelText('External ID')).toBeDisabled();
  });

  it('does not fetch trust setup for an unsaved integration and leaves the field enabled', () => {
    render(<Harness />);

    expect(getAwsTrustSetup).not.toHaveBeenCalled();
    expect(screen.getByLabelText('External ID')).toBeEnabled();
  });
});
