import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmationDialog } from './confirmation-dialog';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ConfirmationDialog', () => {
  it('keeps sync onConfirm behavior: buttons stay enabled and cancel works', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmationDialog
        open
        title="Delete thing?"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons and blocks Escape-close while async onConfirm is pending', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onCancel = vi.fn();
    render(
      <ConfirmationDialog
        open
        title="Delete thing?"
        onConfirm={() => pending.promise}
        onCancel={onCancel}
        confirmingText="Deleting…"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

    await user.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();

    pending.resolve();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled(),
    );

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('associates contentText as the dialog description for screen readers', () => {
    render(
      <ConfirmationDialog
        open
        title="Delete thing?"
        contentText="This action cannot be undone."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'This action cannot be undone.',
    );
  });

  it('omits aria-describedby when there is no contentText', () => {
    render(
      <ConfirmationDialog
        open
        title="Delete thing?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby');
  });

  it('resets pending and stays open when async onConfirm rejects', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onCancel = vi.fn();
    render(
      <ConfirmationDialog
        open
        title="Delete thing?"
        onConfirm={() => pending.promise}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();

    pending.reject(new Error('nope'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled(),
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('resets pending on close so a reopen is not stuck disabled after an in-flight confirm', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const props = {
      title: 'Delete thing?',
      onConfirm: () => pending.promise,
      onCancel: vi.fn(),
    };
    const { rerender } = render(<ConfirmationDialog open {...props} />);

    // Start an async confirm that never settles → buttons go disabled.
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();

    // Parent closes the dialog while onConfirm is still in flight, then reopens
    // it — the reopened dialog must not carry the stale pending state.
    rerender(<ConfirmationDialog open={false} {...props} />);
    rerender(<ConfirmationDialog open {...props} />);

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
});

describe('ConfirmationDialog children', () => {
  it('renders body content below the prompt', () => {
    render(
      <ConfirmationDialog
        open
        title="Delete rule?"
        contentText="Its relationships go with it."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      >
        <label>
          <input type="checkbox" />
          Also delete the direct relationships
        </label>
      </ConfirmationDialog>,
    );

    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  // Interactive controls must not live inside the element aria-describedby
  // points at, or a screen reader announces the checkbox as part of the
  // dialog's description.
  it('keeps body content out of the accessible description', () => {
    render(
      <ConfirmationDialog
        open
        title="Delete rule?"
        contentText="Its relationships go with it."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      >
        <label>
          <input type="checkbox" />
          Also delete the direct relationships
        </label>
      </ConfirmationDialog>,
    );

    const describedBy = screen
      .getByRole('dialog')
      .getAttribute('aria-describedby');
    const description = document.getElementById(describedBy ?? '');

    expect(description).toHaveTextContent('Its relationships go with it.');
    expect(description?.querySelector('input')).toBeNull();
  });

  it('still describes the dialog when there is only body content', () => {
    render(
      <ConfirmationDialog
        open
        title="Delete rule?"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      >
        <p>Body only</p>
      </ConfirmationDialog>,
    );

    expect(screen.getByText('Body only')).toBeInTheDocument();
  });
});
