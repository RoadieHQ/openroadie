import React, { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Terminal,
} from 'lucide-react';
import { Card, CardContent } from '@roadiehq/ui/card';
import { Button } from '@roadiehq/ui/button';
import { CopyButton } from '@roadiehq/ui/copy-button';
import { Spinner } from '@roadiehq/ui/spinner';
import { cn } from '@roadiehq/ui/utils';
import { useMcpAudit, useServiceTokens } from '../../api';
import type { HarnessConfig, InstallStep } from '../../api/mcp-audit';

// A telemetry-only service token: it can post session telemetry and nothing
// else. Baked into the IDE hooks, so if the hook config leaks the token can't
// read data or reach any other endpoint. Kept in sync with SCOPES.mcpTelemetry
// in @roadiehq/scopes-common.
const TELEMETRY_SCOPE = 'mcp-telemetry:create';

// The setup command is always `curl -sf <url> | bash`; the (public) setup
// script forwards this Authorization header into the generated telemetry hooks.
function withAuthHeader(command: string, token: string): string {
  return command.replace(
    /^curl -sf /,
    `curl -sf -H "Authorization: Bearer ${token}" `,
  );
}

function withMcpAuthHeader(command: string, token: string): string {
  return `${command} --header "Authorization: Bearer ${token}"`;
}

const harnessConfigsKey = ['mcpSettings', 'harnessConfigs'] as const;

function StepBlock({ step }: { step: InstallStep }) {
  if (step.type === 'command') {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
        <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
        <code className="flex-1 text-sm break-all text-foreground">
          {step.value}
        </code>
        <CopyButton
          value={step.value}
          label="Copy command"
          className="size-7 shrink-0"
        />
      </div>
    );
  }

  if (step.type === 'deeplink') {
    return (
      <a
        href={step.value}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground hover:bg-muted/50"
      >
        <ExternalLink className="size-3.5" />
        Install in {step.label.replace(/^Install /, '').replace(/ the /, ' ')}
      </a>
    );
  }

  return (
    <div className="relative rounded-md border border-border bg-muted/30 p-3">
      <div className="absolute top-2 right-2">
        <CopyButton
          value={step.value}
          label="Copy config"
          className="size-7 shrink-0"
        />
      </div>
      <pre className="overflow-x-auto pr-8 text-xs text-foreground">
        {step.value}
      </pre>
    </div>
  );
}

function SelectedHarnessSetup({
  config,
  mcpScopes,
}: {
  config: HarnessConfig;
  mcpScopes: string[];
}) {
  const serviceTokens = useServiceTokens();
  const [showFallback, setShowFallback] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      // Non-expiring so users never have to re-install the hooks; revocable
      // from the Service Tokens admin page.
      const grantsMcpAccess = config.harness === 'claude-code';
      const result = await serviceTokens.create({
        name: grantsMcpAccess
          ? `MCP client — ${config.label}`
          : `MCP telemetry — ${config.label}`,
        scopes: grantsMcpAccess
          ? [...new Set([...mcpScopes, TELEMETRY_SCOPE])]
          : [TELEMETRY_SCOPE],
        expiresInDays: null,
      });
      setToken(result.token);
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Failed to generate install command',
      );
    } finally {
      setGenerating(false);
    }
  }, [serviceTokens, config.harness, config.label, mcpScopes]);

  const installStep: InstallStep = token
    ? { ...config.step, value: withAuthHeader(config.step.value, token) }
    : config.step;
  const mcpOnlyStep =
    token && config.harness === 'claude-code' && config.mcpOnlyStep
      ? {
          ...config.mcpOnlyStep,
          value: withMcpAuthHeader(config.mcpOnlyStep.value, token),
        }
      : config.mcpOnlyStep;
  const canShowMcpOnlyStep = config.harness !== 'claude-code' || token;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{config.description}</p>

      {token ? (
        <>
          <StepBlock step={installStep} />
          <p className="text-xs text-muted-foreground">
            {config.harness === 'claude-code'
              ? 'Embeds a token limited to the installed MCP tools and session telemetry.'
              : 'Embeds a telemetry-only access token.'}{' '}
            Revoke it any time from the Service Tokens page.
          </p>
        </>
      ) : (
        <div className="space-y-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={generate}
            disabled={generating}
            type="button"
          >
            {generating ? (
              <Spinner size={14} />
            ) : (
              <Terminal className="size-4" />
            )}
            Generate install command
          </Button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      )}

      {mcpOnlyStep && canShowMcpOnlyStep && (
        <div className="pt-1">
          <Button
            variant="ghost"
            onClick={() => setShowFallback(!showFallback)}
            className="h-auto px-0 py-0 text-xs text-muted-foreground hover:text-foreground"
            type="button"
          >
            {showFallback ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            {mcpOnlyStep.label}
          </Button>
          {showFallback && (
            <div className="mt-2">
              <StepBlock step={mcpOnlyStep} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const OTHER_KEY = '__other__';

export function HarnessSetupSection({ mcpBaseUrl }: { mcpBaseUrl?: string }) {
  const client = useMcpAudit();
  const [selectedHarness, setSelectedHarness] = useState<string | null>(null);

  const { data: configsData } = useQuery({
    queryKey: [...harnessConfigsKey],
    queryFn: () => client.getHarnessConfigs(),
  });

  const harnesses = configsData?.harnesses ?? [];
  const selected = harnesses.find(h => h.harness === selectedHarness) ?? null;

  if (harnesses.length === 0 && !mcpBaseUrl) return null;

  const toggle = (key: string) =>
    setSelectedHarness(selectedHarness === key ? null : key);

  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <p className="text-sm font-medium text-foreground">Connect your IDE</p>

        <div className="flex flex-wrap gap-1.5">
          {harnesses.map(h => (
            <Button
              key={h.harness}
              variant="ghost"
              size="sm"
              onClick={() => toggle(h.harness)}
              className={cn(
                'h-7 rounded-md border px-2.5 text-xs',
                selectedHarness === h.harness
                  ? 'border-foreground/20 bg-muted text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              type="button"
            >
              {h.label}
            </Button>
          ))}
          {mcpBaseUrl && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggle(OTHER_KEY)}
              className={cn(
                'h-7 rounded-md border px-2.5 text-xs',
                selectedHarness === OTHER_KEY
                  ? 'border-foreground/20 bg-muted text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
              type="button"
            >
              Other
            </Button>
          )}
        </div>

        {selected && (
          <SelectedHarnessSetup
            key={selected.harness}
            config={selected}
            mcpScopes={configsData?.mcpScopes ?? []}
          />
        )}

        {selectedHarness === OTHER_KEY && mcpBaseUrl && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Use this endpoint with any MCP-compatible client.
            </p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
              <code className="flex-1 text-sm break-all text-foreground">
                {mcpBaseUrl}
              </code>
              <CopyButton
                value={mcpBaseUrl}
                label="Copy endpoint URL"
                className="size-7 shrink-0"
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
