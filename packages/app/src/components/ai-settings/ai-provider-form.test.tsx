import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AIProviderForm } from './ai-provider-form';

const MASKED = '••••••';

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('AIProviderForm', () => {
  it('submits on Enter in the API key input', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AIProviderForm
        initialProvider={null}
        initialSettings={null}
        onSave={onSave}
        showCancel={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: /OpenAI/ }));
    await user.type(screen.getByLabelText('API Key *'), 'sk-test{Enter}');

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith('openai', { apiKey: 'sk-test' });
  });

  it('accepts a masked key for the configured provider and omits it from the payload', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AIProviderForm
        initialProvider="openai"
        initialSettings={{ apiKey: MASKED }}
        isConfigured
        onSave={onSave}
      />,
    );

    const input = screen.getByLabelText('API Key *');
    expect(input).toHaveValue(MASKED);
    expect(
      screen.getByText('Currently configured. Enter a new value to change.'),
    ).toBeInTheDocument();

    // A dirty-but-still-masked value stays valid for the configured provider
    // and is stripped from the payload.
    await user.clear(input);
    await user.type(input, '••••••••');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith('openai', {});
  });

  it('requires a real key when switching to an unconfigured provider', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AIProviderForm
        initialProvider="openai"
        initialSettings={{ apiKey: MASKED }}
        isConfigured
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Anthropic/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('API Key is required')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('API Key *'), 'sk-ant-new');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith('anthropic', { apiKey: 'sk-ant-new' });
  });

  it('stays pending until save resolves and only then resets to clean', async () => {
    const user = userEvent.setup();
    const pending = deferred();
    const onSave = vi.fn(() => pending.promise);
    render(
      <AIProviderForm
        initialProvider={null}
        initialSettings={null}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole('button', { name: /OpenAI/ }));
    await user.type(screen.getByLabelText('API Key *'), 'sk-test');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByLabelText('API Key *')).toBeDisabled();

    pending.resolve();

    await waitFor(() =>
      expect(screen.getByLabelText('API Key *')).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByLabelText('API Key *')).toHaveValue('sk-test');
  });

  it('keeps edits and shows the error when save fails', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockRejectedValue(new Error('backend down'));
    render(
      <AIProviderForm
        initialProvider={null}
        initialSettings={null}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole('button', { name: /OpenAI/ }));
    await user.type(screen.getByLabelText('API Key *'), 'sk-test');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('backend down')).toBeInTheDocument();
    expect(screen.getByLabelText('API Key *')).toHaveValue('sk-test');
    // The form is still dirty: the failed save must not claim the edits were saved.
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
