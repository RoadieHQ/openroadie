import { screen } from '@testing-library/react';
import { renderWithQuery as render } from '../../../test-utils';
import { AwsTrustSetupPanel } from './aws-trust-setup-panel';

const getAwsTrustSetup = vi.fn();

vi.mock('../../../api', () => ({
  useWorkflows: () => ({ integrations: { getAwsTrustSetup } }),
}));

const STRICT_SETUP = {
  strict: true,
  principalArn: 'arn:aws:iam::131774410247:role/prod0-roadie-next-backend',
  externalId: 'a1b2c3',
  sourceIdentity: 'acme',
  sessionPolicyArns: ['arn:aws:iam::aws:policy/ReadOnlyAccess'],
};

function renderPanel(props: { integrationId?: string; accountIds?: string[] }) {
  return render(<AwsTrustSetupPanel {...props} />);
}

describe('AwsTrustSetupPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('explains that an unsaved integration has no values yet', () => {
    renderPanel({});
    expect(screen.getByText(/save this integration/i)).toBeTruthy();
    expect(getAwsTrustSetup).not.toHaveBeenCalled();
  });

  it('shows the server-derived values', async () => {
    getAwsTrustSetup.mockResolvedValue(STRICT_SETUP);
    renderPanel({ integrationId: 'int-1', accountIds: ['123456789012'] });

    expect(await screen.findByText('a1b2c3')).toBeTruthy();
    expect(screen.getByText(STRICT_SETUP.principalArn)).toBeTruthy();
    expect(screen.getByText('acme')).toBeTruthy();
  });

  it('renders AssumeRole and SetSourceIdentity as two separate statements', async () => {
    getAwsTrustSetup.mockResolvedValue(STRICT_SETUP);
    renderPanel({ integrationId: 'int-1', accountIds: ['123456789012'] });

    const policy = JSON.parse(
      (await screen.findByText(/"Version": "2012-10-17"/)).textContent ?? '{}',
    );
    // One statement per action: sts:ExternalId isn't a populated condition key
    // during AWS's sts:SetSourceIdentity check, so a single statement combining
    // both actions under one Condition block silently denies SetSourceIdentity
    // even when ExternalId matches. Without SetSourceIdentity granted at all,
    // the assume fails outright, so it must be in what we hand the customer.
    const [assumeRole, setSourceIdentity] = policy.Statement;
    expect(assumeRole.Action).toBe('sts:AssumeRole');
    expect(assumeRole.Condition.StringEquals).toEqual({
      'sts:ExternalId': 'a1b2c3',
    });
    expect(assumeRole.Principal.AWS).toBe(STRICT_SETUP.principalArn);

    expect(setSourceIdentity.Action).toBe('sts:SetSourceIdentity');
    expect(setSourceIdentity.Condition.StringEquals).toEqual({
      'sts:SourceIdentity': 'acme',
    });
    expect(setSourceIdentity.Principal.AWS).toBe(STRICT_SETUP.principalArn);
  });

  it('grants SetSourceIdentity even when no source identity is sent', async () => {
    // It is a permission, not a requirement, so granting it is always safe —
    // and it is mandatory as soon as Roadie starts passing a source identity.
    getAwsTrustSetup.mockResolvedValue({
      strict: false,
      principalArn: STRICT_SETUP.principalArn,
      externalId: 'tenant-typed',
      sessionPolicyArns: [],
    });
    renderPanel({ integrationId: 'int-1', accountIds: ['123456789012'] });

    const policy = JSON.parse(
      (await screen.findByText(/"Version": "2012-10-17"/)).textContent ?? '{}',
    );
    const [assumeRole, setSourceIdentity] = policy.Statement;
    expect(assumeRole.Condition.StringEquals).toEqual({
      'sts:ExternalId': 'tenant-typed',
    });
    expect(setSourceIdentity.Action).toBe('sts:SetSourceIdentity');
    // No sts:SourceIdentity condition: a condition on a value we don't send
    // would deny every assume.
    expect(setSourceIdentity.Condition).toBeUndefined();
  });

  it('surfaces a fetch failure instead of showing a wrong policy', async () => {
    getAwsTrustSetup.mockRejectedValue(new Error('no scope on request'));
    renderPanel({ integrationId: 'int-1', accountIds: ['123456789012'] });

    expect(await screen.findByText(/no scope on request/i)).toBeTruthy();
    expect(screen.queryByText(/"Version": "2012-10-17"/)).toBeNull();
  });
});
