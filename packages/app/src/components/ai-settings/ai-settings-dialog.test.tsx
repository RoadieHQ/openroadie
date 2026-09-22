import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@roadiehq/ui/button';
import { TestQueryProvider } from '../../test-utils';
import {
  AISettingsProvider,
  useAISettingsContext,
} from './ai-settings-context';

const agent = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock('../../api', () => ({
  useAgent: () => agent,
}));

const MASKED = '••••••';

function Opener() {
  const { openSettingsDialog, selectedProvider } = useAISettingsContext();
  return (
    <div>
      <Button type="button" onClick={openSettingsDialog}>
        open settings
      </Button>
      <span data-testid="ctx-provider">{selectedProvider ?? 'none'}</span>
    </div>
  );
}

function renderDialog() {
  return render(
    <AISettingsProvider>
      <Opener />
    </AISettingsProvider>,
    { wrapper: TestQueryProvider },
  );
}

async function openAndEditKey(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'open settings' }));
  await screen.findByRole('dialog');
  await user.click(screen.getByRole('button', { name: /Anthropic/ }));
  await user.type(screen.getByLabelText('API Key *'), 'sk-ant-new');
}

describe('AISettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agent.getSettings.mockResolvedValue({
      selectedProvider: 'openai',
      settings: { apiKey: MASKED },
    });
  });

  it('stays open with the error visible and leaves context untouched when save fails', async () => {
    const user = userEvent.setup();
    agent.saveSettings.mockRejectedValue(new Error('backend down'));
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId('ctx-provider')).toHaveTextContent('openai'),
    );
    await openAndEditKey(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('backend down')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-provider')).toHaveTextContent('openai');
  });

  it('closes and updates context only after a successful save', async () => {
    const user = userEvent.setup();
    agent.saveSettings.mockResolvedValue({
      selectedProvider: 'anthropic',
      settings: { apiKey: 'sk-ant-new' },
    });
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId('ctx-provider')).toHaveTextContent('openai'),
    );
    await openAndEditKey(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('ctx-provider')).toHaveTextContent('anthropic');
    expect(agent.saveSettings).toHaveBeenCalledWith({
      provider: 'anthropic',
      settings: { apiKey: 'sk-ant-new' },
    });
  });

  it('does not keep a typed-then-abandoned key across close and reopen', async () => {
    const user = userEvent.setup();
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId('ctx-provider')).toHaveTextContent('openai'),
    );

    await openAndEditKey(user);
    expect(screen.getByLabelText('API Key *')).toHaveValue('sk-ant-new');

    // Abandon the edit by dismissing the dialog (not the Cancel button).
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Reopen: the form must present the initial (configured openai) state, not
    // the abandoned anthropic key.
    await user.click(screen.getByRole('button', { name: 'open settings' }));
    await screen.findByRole('dialog');

    expect(
      screen.queryByRole('button', { name: /Anthropic/, pressed: true }),
    ).toBeNull();
    expect(screen.getByLabelText('API Key *')).toHaveValue(MASKED);
    expect(agent.saveSettings).not.toHaveBeenCalled();
  });

  it('blocks closing via Escape while the save is in flight', async () => {
    const user = userEvent.setup();
    let resolveSave!: (value: unknown) => void;
    agent.saveSettings.mockImplementation(
      () => new Promise(res => (resolveSave = res)),
    );
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId('ctx-provider')).toHaveTextContent('openai'),
    );
    await openAndEditKey(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    resolveSave({});
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
