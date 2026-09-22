import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@roadiehq/ui/tooltip';
import { CreateTokenDialog } from './create-token-dialog';
import type { WebhookTokenSummaryView } from '../../api/webhooks';

type CreatedToken = WebhookTokenSummaryView & { token: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tokenResult: CreatedToken = {
  id: 't-1',
  label: 'openroadie-prod',
  createdAt: '2026-01-01T00:00:00Z',
  lastUsedAt: null,
  token: 'secret-token-value',
};

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /new token/i }));
  await screen.findByRole('dialog');
}

describe('CreateTokenDialog', () => {
  it('cannot open while another token mutation is pending', async () => {
    const user = userEvent.setup();
    const createToken = vi.fn();
    render(
      <TooltipProvider>
        <CreateTokenDialog createToken={createToken} disabled />
      </TooltipProvider>,
    );

    const trigger = screen.getByRole('button', { name: /new token/i });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ignores Esc while the token is being created, then shows the token', async () => {
    const user = userEvent.setup();
    const pending = deferred<CreatedToken>();
    const createToken = vi.fn(() => pending.promise);
    render(
      <TooltipProvider>
        <CreateTokenDialog createToken={createToken} />
      </TooltipProvider>,
    );

    await openDialog(user);
    await user.type(screen.getByLabelText('Label'), 'openroadie-prod');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    pending.resolve(tokenResult);

    expect(await screen.findByText('secret-token-value')).toBeInTheDocument();
    expect(createToken).toHaveBeenCalledWith('openroadie-prod');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('validates the label in-dialog and does not call the API when empty', async () => {
    const user = userEvent.setup();
    const createToken = vi.fn();
    render(
      <TooltipProvider>
        <CreateTokenDialog createToken={createToken} />
      </TooltipProvider>,
    );

    await openDialog(user);
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Label is required')).toBeInTheDocument();
    expect(createToken).not.toHaveBeenCalled();
  });

  it('submits with Enter and trims the label', async () => {
    const user = userEvent.setup();
    const createToken = vi.fn().mockResolvedValue(tokenResult);
    render(
      <TooltipProvider>
        <CreateTokenDialog createToken={createToken} />
      </TooltipProvider>,
    );

    await openDialog(user);
    await user.type(
      screen.getByLabelText('Label'),
      '  openroadie-prod  {Enter}',
    );

    await waitFor(() =>
      expect(createToken).toHaveBeenCalledWith('openroadie-prod'),
    );
  });

  it('shows an API failure inside the dialog and keeps it open', async () => {
    const user = userEvent.setup();
    const createToken = vi.fn().mockRejectedValue(new Error('server exploded'));
    render(
      <TooltipProvider>
        <CreateTokenDialog createToken={createToken} />
      </TooltipProvider>,
    );

    await openDialog(user);
    await user.type(screen.getByLabelText('Label'), 'openroadie-prod');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'server exploded',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Label')).toHaveValue('openroadie-prod');
  });

  it('keeps the one-time token view open on Esc; only Done closes and resets', async () => {
    const user = userEvent.setup();
    const createToken = vi.fn().mockResolvedValue(tokenResult);
    render(
      <TooltipProvider>
        <CreateTokenDialog createToken={createToken} />
      </TooltipProvider>,
    );

    await openDialog(user);
    await user.type(screen.getByLabelText('Label'), 'openroadie-prod');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText('secret-token-value');

    // The X close affordance is hidden while the token is displayed.
    expect(
      screen.queryByRole('button', { name: /close/i }),
    ).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('secret-token-value')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );

    // Reopening starts from a clean create phase.
    await openDialog(user);
    expect(screen.getByLabelText('Label')).toHaveValue('');
    expect(screen.queryByText('secret-token-value')).not.toBeInTheDocument();
  });

  it('clears the copied-indicator timer on unmount', async () => {
    const user = userEvent.setup();
    const createToken = vi.fn().mockResolvedValue(tokenResult);
    const { unmount } = render(
      <TooltipProvider>
        <CreateTokenDialog createToken={createToken} />
      </TooltipProvider>,
    );

    await openDialog(user);
    await user.type(screen.getByLabelText('Label'), 'openroadie-prod');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByText('secret-token-value');

    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      act(() => {
        vi.runOnlyPendingTimers();
      });
      expect(vi.getTimerCount()).toBe(0);

      fireEvent.click(screen.getByRole('button', { name: 'Copy token' }));
      // Let the clipboard write settle so the reset timer gets scheduled.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(vi.getTimerCount()).toBe(1);
      const copiedTimerIndex = setTimeoutSpy.mock.calls.findIndex(
        call => call[1] === 2000,
      );
      expect(copiedTimerIndex).toBeGreaterThanOrEqual(0);
      const copiedTimerId =
        setTimeoutSpy.mock.results[Number(copiedTimerIndex)].value;

      unmount();
      // Radix schedules its own teardown timer on unmount, so assert on the
      // copied timer specifically rather than the global timer count.
      expect(clearTimeoutSpy).toHaveBeenCalledWith(copiedTimerId);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});
