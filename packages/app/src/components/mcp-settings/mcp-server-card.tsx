import React, { useCallback, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@roadiehq/ui/card';
import { Switch } from '@roadiehq/ui/switch';
import { Badge } from '@roadiehq/ui/badge';
import { Button } from '@roadiehq/ui/button';
import { CopyButton } from '@roadiehq/ui/copy-button';
import { InlineCode } from '@roadiehq/ui/inline-code';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { McpServerSettings } from '../../api/mcp-settings';
import { LIFECYCLE } from '../overview';

interface McpServerCardProps {
  server: McpServerSettings;
  mcpBaseUrl: string;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onToggleTool: (toolName: string, enabled: boolean) => Promise<void>;
}

export function McpServerCard({
  server,
  mcpBaseUrl,
  onToggle,
  onToggleTool,
}: McpServerCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [pendingToggles, setPendingToggles] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const endpointUrl = `${mcpBaseUrl}/${server.id}/`;

  const runToggle = useCallback(
    async (key: string, run: () => Promise<void>) => {
      setPendingToggles(prev => new Set(prev).add(key));
      try {
        // The parent owns error handling (revert + alert); awaiting here only
        // keeps the switch disabled until the mutation settles.
        await run();
      } finally {
        setPendingToggles(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [],
  );

  const serverToggleKey = `server:${server.id}`;

  const enabledToolCount = server.tools.filter(t => t.enabled).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              {server.name}
              <Badge
                variant={server.enabled ? 'successOutline' : 'outlineMuted'}
              >
                {server.enabled
                  ? LIFECYCLE.enabled.label
                  : LIFECYCLE.disabled.label}
              </Badge>
            </CardTitle>
            <CardDescription>{server.description}</CardDescription>
          </div>
          <Switch
            checked={server.enabled}
            disabled={pendingToggles.has(serverToggleKey)}
            onCheckedChange={checked =>
              runToggle(serverToggleKey, () => onToggle(server.id, checked))
            }
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <Button
          variant="ghost"
          onClick={() => setExpanded(!expanded)}
          className="h-auto px-0 py-0 text-xs text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          {enabledToolCount}/{server.tools.length} tool
          {server.tools.length !== 1 ? 's' : ''} enabled
        </Button>

        {expanded && (
          <div className="space-y-3">
            <ul className="ml-4 space-y-2.5">
              {server.tools.map(tool => (
                <li
                  key={tool.name}
                  className="flex items-start justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <code
                      className={
                        tool.enabled
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground/50 line-through'
                      }
                    >
                      {tool.name}
                    </code>
                    {tool.description && (
                      <p
                        className={`mt-0.5 text-[11px] leading-snug ${
                          tool.enabled
                            ? 'text-muted-foreground/70'
                            : 'text-muted-foreground/40'
                        }`}
                      >
                        {tool.description}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={tool.enabled}
                    disabled={
                      !server.enabled || pendingToggles.has(`tool:${tool.name}`)
                    }
                    onCheckedChange={checked =>
                      runToggle(`tool:${tool.name}`, () =>
                        onToggleTool(tool.name, checked),
                      )
                    }
                    className="mt-0.5 shrink-0 scale-75"
                  />
                </li>
              ))}
            </ul>

            {server.enabled && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Endpoint:</span>
                <InlineCode className="break-all">{endpointUrl}</InlineCode>
                <CopyButton
                  value={endpointUrl}
                  label="Copy endpoint URL"
                  className="shrink-0"
                />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
