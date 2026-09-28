import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HarnessSetupSection } from './harness-setup-section';
import { TestQueryProvider } from '../../test-utils';
import { ResponseError } from '../../api/infrastructure';

const mockMcpAuditClient = {
  getHarnessConfigs: vi.fn(),
};
const mockServiceTokensClient = {
  create: vi.fn(),
};

vi.mock('../../api', () => ({
  useMcpAudit: () => mockMcpAuditClient,
  useServiceTokens: () => mockServiceTokensClient,
}));

const SETUP_COMMAND =
  'curl -sf http://localhost:7008/api/mcp/harness-plugin/claude-code/setup.sh | bash';

beforeEach(() => {
  vi.clearAllMocks();
  mockMcpAuditClient.getHarnessConfigs.mockResolvedValue({
    harnesses: [
      {
        harness: 'claude-code',
        label: 'Claude Code',
        telemetrySupport: 'full',
        step: {
          label: 'Install the openroadie plugin',
          type: 'command',
          value: SETUP_COMMAND,
        },
        mcpOnlyStep: {
          label: 'MCP server only (no telemetry)',
          type: 'command',
          value:
            'claude mcp add openroadie --transport http http://localhost:7008/api/mcp/v1/',
        },
        description: 'Installs the MCP server and session telemetry.',
      },
    ],
    mcpScopes: ['catalog-datastore:query'],
  });
});

async function generateForClaudeCode() {
  render(<HarnessSetupSection />, { wrapper: TestQueryProvider });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Claude Code' }),
  );
  await userEvent.click(
    screen.getByRole('button', { name: /generate install command/i }),
  );
}

describe('HarnessSetupSection', () => {
  it('embeds the generated token in the install command', async () => {
    mockServiceTokensClient.create.mockResolvedValue({ token: 'rst_abc' });

    await generateForClaudeCode();

    expect(
      await screen.findByText(
        `curl -sf -H "Authorization: Bearer rst_abc" http://localhost:7008/api/mcp/harness-plugin/claude-code/setup.sh | bash`,
      ),
    ).toBeInTheDocument();
  });

  it('falls back to the tokenless command when the deployment has no token issuer', async () => {
    mockServiceTokensClient.create.mockRejectedValue(
      new ResponseError('Request failed with status 404 Not Found', 404),
    );

    await generateForClaudeCode();

    expect(await screen.findByText(SETUP_COMMAND)).toBeInTheDocument();
    expect(
      screen.getByText(/doesn't issue service tokens/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/404 Not Found/)).not.toBeInTheDocument();
  });

  it('still reports other token failures', async () => {
    mockServiceTokensClient.create.mockRejectedValue(
      new ResponseError('Request failed with status 500 Server Error', 500),
    );

    await generateForClaudeCode();

    expect(
      await screen.findByText('Request failed with status 500 Server Error'),
    ).toBeInTheDocument();
    expect(screen.queryByText(SETUP_COMMAND)).not.toBeInTheDocument();
  });
});
