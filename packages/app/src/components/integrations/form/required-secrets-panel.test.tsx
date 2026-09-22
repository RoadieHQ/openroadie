import { screen, waitFor } from '@testing-library/react';
import { SecretStatusType } from '../../../api/secrets';
import { renderWithQuery as render } from '../../../test-utils';
import { RequiredSecretsPanel } from './required-secrets-panel';

const mockSecretsApi = {
  getStorageMode: vi.fn(),
  getSecret: vi.fn(),
  upsertSecret: vi.fn(),
  deleteSecret: vi.fn(),
  deleteSecretMetadata: vi.fn(),
};

const mockAlertApi = {
  post: vi.fn(),
};

vi.mock('../../../api', () => ({
  useSecrets: () => mockSecretsApi,
  useAlert: () => mockAlertApi,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('RequiredSecretsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render hidden scoped secret refs before storage mode finishes loading', async () => {
    const storageMode = deferred<{
      mode: 'scoped';
      readOnly: boolean;
      hiddenSecretRefs: string[];
    }>();

    mockSecretsApi.getStorageMode.mockReturnValue(storageMode.promise);

    render(<RequiredSecretsPanel secretRefs={['ROADIE_SCOPE_SECRET']} />);

    expect(screen.getByText('Required secrets')).toBeInTheDocument();
    expect(screen.queryByText('ROADIE_SCOPE_SECRET')).not.toBeInTheDocument();

    storageMode.resolve({
      mode: 'scoped',
      readOnly: false,
      hiddenSecretRefs: ['ROADIE_SCOPE_SECRET'],
    });

    await waitFor(() => {
      expect(screen.queryByText('Required secrets')).not.toBeInTheDocument();
    });
    expect(mockSecretsApi.getSecret).not.toHaveBeenCalled();
  });

  it('shows the permissions help after the docs link in the shared secret box', async () => {
    mockSecretsApi.getStorageMode.mockResolvedValue({
      mode: 'dotenv',
      readOnly: false,
    });
    mockSecretsApi.getSecret.mockResolvedValue({
      name: 'PULUMI_ACCESS_TOKEN',
      value: '',
      description: 'Token for the built-in Pulumi integration.',
      helpUrl: 'https://www.pulumi.com/docs/',
      status: SecretStatusType.Not_Set,
    });

    render(<RequiredSecretsPanel secretRefs={['PULUMI_ACCESS_TOKEN']} />);

    expect(
      await screen.findByRole('link', { name: /docs/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'PULUMI_ACCESS_TOKEN permissions help',
      }),
    ).toBeInTheDocument();
  });

  it('does not show the permissions help for identifier-style secrets', async () => {
    mockSecretsApi.getStorageMode.mockResolvedValue({
      mode: 'dotenv',
      readOnly: false,
    });
    mockSecretsApi.getSecret.mockResolvedValue({
      name: 'AZURE_AD_TENANT_ID',
      value: '',
      description: 'Azure AD tenant ID for the built-in Azure integration.',
      helpUrl: 'https://learn.microsoft.com/en-us/entra/',
      status: SecretStatusType.Not_Set,
    });

    render(<RequiredSecretsPanel secretRefs={['AZURE_AD_TENANT_ID']} />);

    expect(
      await screen.findByRole('link', { name: /docs/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'AZURE_AD_TENANT_ID permissions help',
      }),
    ).not.toBeInTheDocument();
  });
});
