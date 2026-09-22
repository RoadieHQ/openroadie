import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useForm } from 'react-hook-form';
import { Input } from '@roadiehq/ui/input';
import { FormDialog } from './form-dialog';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Harness({
  onSubmit,
  onOpenChange = () => {},
  submitDisabled = false,
}: {
  onSubmit: (values: { name: string }) => void | Promise<void>;
  onOpenChange?: (open: boolean) => void;
  submitDisabled?: boolean;
}) {
  const form = useForm<{ name: string }>({
    defaultValues: { name: 'initial' },
  });

  return (
    <FormDialog
      open
      onOpenChange={onOpenChange}
      title="Test dialog"
      form={form}
      onSubmit={onSubmit}
      submitLabel="Save"
      submitDisabled={submitDisabled}
    >
      <Input aria-label="Name" {...form.register('name')} />
    </FormDialog>
  );
}

describe('FormDialog', () => {
  it('submits via Enter in a field', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Name'), '{Enter}');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'initial' });
  });

  it('blocks close requests while submitting', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn(() => pending.promise);
    render(<Harness onSubmit={onSubmit} onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();

    pending.resolve();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );

    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders a rejected onSubmit as a root error and stays open', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn().mockRejectedValue(new Error('server exploded'));
    render(<Harness onSubmit={onSubmit} onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'server exploded',
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('wires the description prop as the dialog aria-describedby', () => {
    function DescribedHarness() {
      const form = useForm<{ name: string }>({
        defaultValues: { name: 'initial' },
      });
      return (
        <FormDialog
          open
          onOpenChange={() => {}}
          title="Test dialog"
          description="Fill in the details below."
          form={form}
          onSubmit={() => {}}
          submitLabel="Save"
        >
          <Input aria-label="Name" {...form.register('name')} />
        </FormDialog>
      );
    }
    render(<DescribedHarness />);

    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'Fill in the details below.',
    );
  });

  it('omits aria-describedby when no description is provided', () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby');
  });

  it('does not submit via Enter when submitDisabled is set', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} submitDisabled />);

    await user.type(screen.getByLabelText('Name'), '{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('clears a stale root error when a retried submit succeeds', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error('server exploded'))
      .mockResolvedValueOnce(undefined);
    render(<Harness onSubmit={onSubmit} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'server exploded',
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it('submits once on double click', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onSubmit = vi.fn(() => pending.promise);
    render(<Harness onSubmit={onSubmit} />);

    await user.dblClick(screen.getByRole('button', { name: 'Save' }));

    pending.resolve();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
    );
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
