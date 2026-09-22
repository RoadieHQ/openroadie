import React from 'react';
import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpServerCard } from './mcp-server-card';
import { McpServersPage } from './mcp-servers-page';
import { McpSettingsProvider } from './mcp-settings-context';
import { TestQueryProvider } from '../../test-utils';
import { TooltipProvider } from '@roadiehq/ui/tooltip';
import type { McpServerSettings } from '../../api/mcp-settings';

const mockAlertApi = { post: vi.fn() };
const mockClient = {
  getServers: vi.fn(),
  setServersEnabled: vi.fn(),
  setToolsEnabled: vi.fn(),
};

const mockMcpAuditClient = {
  getHarnessConfigs: vi.fn().mockResolvedValue({ harnesses: [] }),
};

vi.mock('../../api', () => ({
  useMcpSettings: () => mockClient,
  useAppConfig: () => ({ backend: { baseUrl: 'http://localhost:7008' } }),
  useAlert: () => mockAlertApi,
  useMcpAudit: () => mockMcpAuditClient,
}));

function makeServer(overrides?: Partial<McpServerSettings>): McpServerSettings {
  return {
    id: 'catalog',
    name: 'Catalog',
    description: 'Catalog MCP server',
    enabled: true,
    tools: [
      {
        name: 'catalog-search',
        description: 'Search the catalog',
        enabled: true,
      },
    ],
    ...overrides,
  };
}

const baseUrl = 'http://localhost:7008/api/mcp/v1';

function renderCard(
  props?: Partial<React.ComponentProps<typeof McpServerCard>>,
) {
  return render(
    <TooltipProvider>
      <McpServerCard
        server={makeServer()}
        mcpBaseUrl={baseUrl}
        onToggle={vi.fn().mockResolvedValue(undefined)}
        onToggleTool={vi.fn().mockResolvedValue(undefined)}
        {...props}
      />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('McpServerCard', () => {
  describe('server toggle', () => {
    it('disables the server switch while the toggle is in flight', async () => {
      const user = userEvent.setup();
      let resolveToggle!: () => void;
      const onToggle = vi.fn(
        () =>
          new Promise<void>(resolve => {
            resolveToggle = resolve;
          }),
      );
      renderCard({ onToggle });

      const switchEl = screen.getByRole('switch');
      await user.click(switchEl);

      expect(onToggle).toHaveBeenCalledWith('catalog', false);
      expect(switchEl).toBeDisabled();

      resolveToggle();
      await waitFor(() => expect(switchEl).toBeEnabled());
    });
  });

  describe('tool toggle', () => {
    it('disables the tool switch while its toggle is in flight', async () => {
      const user = userEvent.setup();
      let resolveToggle!: () => void;
      const onToggleTool = vi.fn(
        () =>
          new Promise<void>(resolve => {
            resolveToggle = resolve;
          }),
      );
      renderCard({ onToggleTool });

      await user.click(screen.getByRole('button', { name: /tool.*enabled/ }));
      const [serverSwitch, toolSwitch] = screen.getAllByRole('switch');
      await user.click(toolSwitch!);

      expect(onToggleTool).toHaveBeenCalledWith('catalog-search', false);
      expect(toolSwitch).toBeDisabled();
      expect(serverSwitch).toBeEnabled();

      resolveToggle();
      await waitFor(() => expect(toolSwitch).toBeEnabled());
    });
  });

  describe('copy endpoint URL', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    beforeEach(() => {
      vi.useFakeTimers();
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('resets the copied indicator after 2 seconds', async () => {
      renderCard();

      fireEvent.click(screen.getByRole('button', { name: /tool.*enabled/ }));
      const copyButton = screen.getByRole('button', {
        name: 'Copy endpoint URL',
      });
      fireEvent.click(copyButton);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(writeText).toHaveBeenCalledWith(`${baseUrl}/catalog/`);
      expect(copyButton).toHaveClass('text-success');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(copyButton).not.toHaveClass('text-success');
    });

    it('does not update state after unmount when the copy timer fires', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { unmount } = renderCard();

      fireEvent.click(screen.getByRole('button', { name: /tool.*enabled/ }));
      fireEvent.click(
        screen.getByRole('button', { name: 'Copy endpoint URL' }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      unmount();
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});

describe('McpServersPage toggle failures', () => {
  function renderPage() {
    return render(
      <TooltipProvider>
        <McpSettingsProvider>
          <McpServersPage />
        </McpSettingsProvider>
      </TooltipProvider>,
      { wrapper: TestQueryProvider },
    );
  }

  it('reverts the server switch and posts an error alert when the toggle fails', async () => {
    const user = userEvent.setup();
    mockClient.getServers.mockResolvedValue([makeServer({ enabled: true })]);
    mockClient.setServersEnabled.mockRejectedValue(
      new Error('Failed to update servers'),
    );
    renderPage();

    const switchEl = await screen.findByRole('switch');
    expect(switchEl).toBeChecked();

    await user.click(switchEl);

    await waitFor(() => {
      expect(mockAlertApi.post).toHaveBeenCalledWith({
        message: 'Failed to update servers',
        severity: 'error',
      });
    });
    expect(switchEl).toBeChecked();
    expect(switchEl).toBeEnabled();
  });

  it('reverts the tool switch and posts an error alert when the tool toggle fails', async () => {
    const user = userEvent.setup();
    mockClient.getServers.mockResolvedValue([makeServer()]);
    mockClient.setToolsEnabled.mockRejectedValue(
      new Error('Failed to update tools'),
    );
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: /tool.*enabled/ }),
    );
    const [, toolSwitch] = screen.getAllByRole('switch');
    expect(toolSwitch).toBeChecked();

    await user.click(toolSwitch!);

    await waitFor(() => {
      expect(mockAlertApi.post).toHaveBeenCalledWith({
        message: 'Failed to update tools',
        severity: 'error',
      });
    });
    expect(toolSwitch).toBeChecked();
    expect(toolSwitch).toBeEnabled();
  });

  it('applies the authoritative server list from a successful toggle, not the optimistic guess', async () => {
    const user = userEvent.setup();
    mockClient.getServers.mockResolvedValue([
      makeServer({ id: 'catalog', name: 'Catalog', enabled: true }),
    ]);
    // The optimistic update only maps over the current single server, so it can
    // never add a second one. The backend's authoritative response does — proving
    // onSuccess wrote the returned payload rather than leaving the optimistic guess.
    mockClient.setServersEnabled.mockResolvedValue([
      makeServer({ id: 'catalog', name: 'Catalog', enabled: false }),
      makeServer({ id: 'search', name: 'Search', enabled: true }),
    ]);
    renderPage();

    expect(await screen.findByRole('switch')).toBeChecked();
    expect(screen.getAllByRole('switch')).toHaveLength(1);

    await user.click(screen.getByRole('switch'));

    await waitFor(() => expect(screen.getAllByRole('switch')).toHaveLength(2));
    expect(mockAlertApi.post).not.toHaveBeenCalled();
  });
});
