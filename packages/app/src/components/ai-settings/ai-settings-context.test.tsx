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

function Harness({ onError }: { onError: (e: unknown) => void }) {
  const { selectedProvider, settings, saveSettings } = useAISettingsContext();
  return (
    <div>
      <span data-testid="provider">{selectedProvider ?? 'none'}</span>
      <span data-testid="settings">
        {settings ? JSON.stringify(settings) : 'none'}
      </span>
      <Button
        type="button"
        onClick={() => {
          saveSettings('anthropic', { apiKey: 'sk-ant-new' }).catch(onError);
        }}
      >
        save
      </Button>
    </div>
  );
}

describe('AISettingsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agent.getSettings.mockResolvedValue({
      selectedProvider: null,
      settings: null,
    });
  });

  it('does not update state when the backend save fails, and rethrows', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    agent.saveSettings.mockRejectedValue(new Error('save failed'));

    render(
      <AISettingsProvider>
        <Harness onError={onError} />
      </AISettingsProvider>,
      { wrapper: TestQueryProvider },
    );

    await user.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(screen.getByTestId('provider')).toHaveTextContent('none');
    expect(screen.getByTestId('settings')).toHaveTextContent('none');
  });

  it('updates state only after the backend save succeeds', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    agent.saveSettings.mockResolvedValue({
      selectedProvider: 'anthropic',
      settings: { apiKey: 'sk-ant-new' },
    });

    render(
      <AISettingsProvider>
        <Harness onError={onError} />
      </AISettingsProvider>,
      { wrapper: TestQueryProvider },
    );

    await user.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() =>
      expect(screen.getByTestId('provider')).toHaveTextContent('anthropic'),
    );
    expect(screen.getByTestId('settings')).toHaveTextContent(
      JSON.stringify({ apiKey: 'sk-ant-new' }),
    );
    expect(agent.saveSettings).toHaveBeenCalledWith({
      provider: 'anthropic',
      settings: { apiKey: 'sk-ant-new' },
    });
    expect(onError).not.toHaveBeenCalled();
  });
});
