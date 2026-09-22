import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditSecretButton } from './edit-secret-button';
import { SecretStatusType } from '../../api/secrets';
import type { Secret } from '../../api/secrets';
import { TestQueryProvider } from '../../test-utils';

const mockEditSecret = vi.fn();
const mockSetSecret = vi.fn();
const mockDeleteSecret = vi.fn();
const mockDeleteSecretMetadata = vi.fn();
const mockAlertPost = vi.fn();

vi.mock('../../api', () => ({
  useSecrets: () => ({
    editSecret: mockEditSecret,
    setSecret: mockSetSecret,
    deleteSecret: mockDeleteSecret,
    deleteSecretMetadata: mockDeleteSecretMetadata,
  }),
  useAlert: () => ({ post: mockAlertPost }),
}));

const mockUseSecretSettings = vi.fn();
vi.mock('./secret-settings-context', () => ({
  useSecretSettings: () => mockUseSecretSettings(),
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSecret(overrides?: Partial<Secret>): Secret {
  return {
    name: 'GITHUB_TOKEN',
    value: '',
    description: 'GitHub personal access token',
    status: SecretStatusType.Available,
    isCustom: true,
    ...overrides,
  };
}

function renderOpen({
  secret = makeSecret(),
  refreshData = vi.fn().mockResolvedValue(undefined),
  handleClose = vi.fn(),
  open = true,
} = {}) {
  render(
    <EditSecretButton
      secret={secret}
      refreshData={refreshData}
      open={open}
      handleClickOpen={vi.fn()}
      handleClose={handleClose}
    />,
    { wrapper: TestQueryProvider },
  );
  return { refreshData, handleClose };
}

async function openActionsMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /actions/i }));
  await waitFor(() => {
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
}

describe('EditSecretButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEditSecret.mockResolvedValue(undefined);
    mockSetSecret.mockResolvedValue(undefined);
    mockDeleteSecret.mockResolvedValue(undefined);
    mockDeleteSecretMetadata.mockResolvedValue(undefined);
    mockUseSecretSettings.mockReturnValue({ readOnly: false });
  });

  it('keeps the dialog open with a root error and the typed value when saving the value fails', async () => {
    const user = userEvent.setup();
    mockSetSecret.mockRejectedValue(new Error('vault unavailable'));
    const { handleClose } = renderOpen();

    await user.type(screen.getByLabelText('Secret Value'), 'new-value');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        'Updating the secret value failed: vault unavailable',
      ),
    ).toBeVisible();
    expect(handleClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Secret Value')).toHaveValue('new-value');
  });

  it('reports that metadata saved but the value failed when only the value update rejects', async () => {
    const user = userEvent.setup();
    mockSetSecret.mockRejectedValue(new Error('vault unavailable'));
    const { refreshData, handleClose } = renderOpen();

    await user.type(screen.getByLabelText('Description'), ' updated');
    await user.type(screen.getByLabelText('Secret Value'), 'new-value');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        'The description and help URL were saved, but updating the secret value failed: vault unavailable',
      ),
    ).toBeVisible();
    expect(mockEditSecret).toHaveBeenCalledTimes(1);
    expect(refreshData).toHaveBeenCalled();
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('requires confirmation before deleting and does not delete on cancel', async () => {
    const user = userEvent.setup();
    renderOpen({ open: false });

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));

    const confirmation = await screen.findByTestId('confirmation-dialog');
    expect(
      within(confirmation).getByText('Delete GITHUB_TOKEN?'),
    ).toBeVisible();
    expect(mockDeleteSecret).not.toHaveBeenCalled();

    await user.click(
      within(confirmation).getByRole('button', { name: 'Cancel' }),
    );

    await waitFor(() =>
      expect(screen.queryByTestId('confirmation-dialog')).toBeNull(),
    );
    expect(mockDeleteSecret).not.toHaveBeenCalled();
    expect(mockDeleteSecretMetadata).not.toHaveBeenCalled();
  });

  it('deletes after confirmation and refreshes the data', async () => {
    const user = userEvent.setup();
    const { refreshData, handleClose } = renderOpen({ open: false });

    await openActionsMenu(user);
    await user.click(screen.getByRole('menuitem', { name: /delete/i }));
    await user.click(
      await screen.findByTestId('delete-btn-confirmation-dialog'),
    );

    await waitFor(() => expect(handleClose).toHaveBeenCalled());
    expect(mockDeleteSecret).toHaveBeenCalledWith('GITHUB_TOKEN');
    expect(mockDeleteSecretMetadata).toHaveBeenCalledWith('GITHUB_TOKEN');
    expect(refreshData).toHaveBeenCalled();
  });

  it('closes only after refreshData resolves', async () => {
    const user = userEvent.setup();
    const pendingRefresh = deferred();
    const refreshData = vi.fn().mockReturnValue(pendingRefresh.promise);
    const handleClose = vi.fn();
    renderOpen({ refreshData, handleClose });

    await user.type(screen.getByLabelText('Secret Value'), 'new-value');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockSetSecret).toHaveBeenCalledTimes(1));
    expect(handleClose).not.toHaveBeenCalled();

    pendingRefresh.resolve();
    await waitFor(() => expect(handleClose).toHaveBeenCalledTimes(1));
  });

  it('submits on Enter in a text field', async () => {
    const user = userEvent.setup();
    renderOpen();

    await user.type(screen.getByLabelText('Description'), ' updated{Enter}');

    await waitFor(() => expect(mockEditSecret).toHaveBeenCalledTimes(1));
    expect(mockEditSecret).toHaveBeenCalledWith('GITHUB_TOKEN', {
      description: 'GitHub personal access token updated',
      helpUrl: null,
    });
  });
});
