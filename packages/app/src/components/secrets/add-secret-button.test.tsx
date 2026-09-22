import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddSecretButton } from './add-secret-button';

const mockUpsertSecret = vi.fn();

vi.mock('../../api', () => ({
  useSecrets: () => ({
    upsertSecret: mockUpsertSecret,
  }),
  useAlert: () => ({ post: vi.fn() }),
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

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add Secret' }));
  await screen.findByRole('dialog');
}

describe('AddSecretButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertSecret.mockResolvedValue(undefined);
    mockUseSecretSettings.mockReturnValue({ readOnly: false });
  });

  it('does not render when the secret store is read-only', () => {
    mockUseSecretSettings.mockReturnValue({ readOnly: true });

    render(<AddSecretButton refreshData={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Add Secret' })).toBeNull();
  });

  it('rejects a lowercase name with an inline error and does not call the API', async () => {
    const user = userEvent.setup();
    render(<AddSecretButton refreshData={vi.fn()} />);
    await openDialog(user);

    await user.type(screen.getByLabelText('Secret Name *'), 'my_token');
    await user.type(screen.getByLabelText('Value *'), 'some-value');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        'Use uppercase letters, digits and underscores, e.g. MY_API_TOKEN',
      ),
    ).toBeVisible();
    expect(mockUpsertSecret).not.toHaveBeenCalled();
  });

  it('accepts an empty help URL and submits it as undefined', async () => {
    const user = userEvent.setup();
    const refreshData = vi.fn().mockResolvedValue(undefined);
    render(<AddSecretButton refreshData={refreshData} />);
    await openDialog(user);

    await user.type(screen.getByLabelText('Secret Name *'), 'MY_TOKEN');
    await user.type(screen.getByLabelText('Value *'), 'some-value');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpsertSecret).toHaveBeenCalledTimes(1));
    expect(mockUpsertSecret).toHaveBeenCalledWith({
      name: 'MY_TOKEN',
      description: undefined,
      helpUrl: undefined,
      internalKeyName: 'MY_TOKEN',
      value: 'some-value',
    });
  });

  it('trims the name and value in the API payload', async () => {
    const user = userEvent.setup();
    render(
      <AddSecretButton refreshData={vi.fn().mockResolvedValue(undefined)} />,
    );
    await openDialog(user);

    await user.type(screen.getByLabelText('Secret Name *'), '  MY_TOKEN  ');
    await user.type(screen.getByLabelText('Value *'), '  some-value  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpsertSecret).toHaveBeenCalledTimes(1));
    expect(mockUpsertSecret).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'MY_TOKEN', value: 'some-value' }),
    );
  });

  it('calls the API once when Save is double-clicked while pending', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    mockUpsertSecret.mockReturnValue(pending.promise);
    render(
      <AddSecretButton refreshData={vi.fn().mockResolvedValue(undefined)} />,
    );
    await openDialog(user);

    await user.type(screen.getByLabelText('Secret Name *'), 'MY_TOKEN');
    await user.type(screen.getByLabelText('Value *'), 'some-value');
    await user.dblClick(screen.getByRole('button', { name: 'Save' }));

    pending.resolve();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockUpsertSecret).toHaveBeenCalledTimes(1);
  });

  it('associates the name helper text with the input via aria-describedby', async () => {
    const user = userEvent.setup();
    render(<AddSecretButton refreshData={vi.fn()} />);
    await openDialog(user);

    const nameInput = screen.getByLabelText('Secret Name *');
    const describedBy = nameInput.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const descriptionElement = document.getElementById(
      (describedBy ?? '').split(' ')[0],
    );
    expect(descriptionElement).toHaveTextContent(
      /Use uppercase letters with underscores/,
    );
  });
});
