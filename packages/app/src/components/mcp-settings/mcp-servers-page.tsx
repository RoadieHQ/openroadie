import React from 'react';
import {
  CardListLoadingView,
  OverviewListingPageHeader,
  OverviewListingStandaloneBody,
} from '../common';
import { useMcpSettingsContext } from './mcp-settings-context';
import { McpServerCard } from './mcp-server-card';
import { HarnessSetupSection } from './harness-setup-section';

const MCP_SERVERS_DESCRIPTION =
  'Configure which MCP servers are available for AI agents and tools to ' +
  'connect to. The root endpoint serves the combined tool set of all ' +
  'enabled servers.';

export function McpServersPage() {
  const { servers, isLoading, toggleServer, toggleTool, mcpBaseUrl } =
    useMcpSettingsContext();

  const enabledCount = servers.filter(s => s.enabled).length;

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <OverviewListingStandaloneBody className="flex min-h-0 flex-1 flex-col space-y-4 sm:space-y-6">
        <div className="shrink-0">
          <OverviewListingPageHeader
            title="MCP Servers"
            description={MCP_SERVERS_DESCRIPTION}
          />
        </div>

        {isLoading ? (
          <CardListLoadingView count={3} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col space-y-4">
            <HarnessSetupSection
              mcpBaseUrl={enabledCount > 0 ? `${mcpBaseUrl}/` : undefined}
            />
            {servers.map(server => (
              <McpServerCard
                key={server.id}
                server={server}
                mcpBaseUrl={mcpBaseUrl}
                onToggle={toggleServer}
                onToggleTool={toggleTool}
              />
            ))}
          </div>
        )}
      </OverviewListingStandaloneBody>
    </div>
  );
}
