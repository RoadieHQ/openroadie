import React from 'react';
import { Box, Text, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import { palette } from './theme';
import { authLabel } from './helpers';
import { useRevealCount } from './hooks';
import { menuStages, stages } from './types';
import type { ConnectView, FooterHint, Integration } from './types';

// The left sidebar is `width={31}` with a right border (1) + paddingLeft (1) +
// paddingRight (2), leaving exactly 24 columns of usable text. A wider rule wraps
// onto a second line (the old `repeat(26)` did). Keep these in sync.
const SIDEBAR_WIDTH = 31;
const SIDEBAR_RULE_WIDTH = 24;

export function Layout({
  children,
  stageIndex,
  footerHints,
}: {
  children: React.ReactNode;
  stageIndex: number;
  footerHints: FooterHint[];
}) {
  const { stdout } = useStdout();
  const height = stdout.rows ?? 24;
  const width = stdout.columns ?? 100;
  const navVisible = useRevealCount(menuStages.length, 65);
  const footerText = [...footerHints, { key: 'q', label: 'quit' }]
    .map(hint => `${hint.key} ${hint.label}`)
    .join(' · ');

  return (
    <Box
      width={width}
      minHeight={height}
      flexDirection="column"
      backgroundColor={palette.bg}
    >
      <Box flexGrow={1}>
        <Box
          width={SIDEBAR_WIDTH}
          flexShrink={0}
          minHeight={height - 1}
          paddingTop={2}
          paddingLeft={1}
          paddingRight={2}
          flexDirection="column"
          borderRight
          borderColor={palette.blue}
          backgroundColor={palette.bg}
        >
          <Box height={3} flexDirection="column">
            <Text color={palette.orange} bold>
              OpenRoadie
            </Text>
            <Text color={palette.railLine}>
              {'─'.repeat(SIDEBAR_RULE_WIDTH)}
            </Text>
          </Box>
          <Box marginTop={2} flexDirection="column">
            {menuStages.slice(0, navVisible).map(item => {
              const stageIdx = stages.indexOf(item);
              const complete = stageIdx < stageIndex;
              const active = stageIdx === stageIndex;
              const marker = complete ? '✓' : active ? '●' : '○';
              const color = complete
                ? palette.green
                : active
                  ? palette.orange
                  : palette.dim;
              return (
                <Text key={item} color={color}>
                  {marker.padEnd(2, ' ')}
                  {item}
                </Text>
              );
            })}
          </Box>
        </Box>
        <Box
          paddingTop={2}
          paddingLeft={2}
          paddingRight={3}
          flexGrow={1}
          backgroundColor={palette.bg}
        >
          {children}
        </Box>
      </Box>
      <Box height={1} paddingLeft={1} backgroundColor={palette.bg}>
        <Text color={palette.dim}>{footerText}</Text>
      </Box>
    </Box>
  );
}

export function Header({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: React.ReactNode;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={palette.white} bold>
        {title}
      </Text>
      {subtitle ? <Text color={palette.dim}>{subtitle}</Text> : null}
    </Box>
  );
}

export function Loading() {
  return (
    <Box flexDirection="column">
      <Header title="Select Integrations" subtitle="Loading from OpenRoadie…" />
      <Text color={palette.orange}>
        <Spinner type="dots" /> Reading integrations from the CLI
      </Text>
    </Box>
  );
}

export function LoadError({ message }: { message: string }) {
  return (
    <Box flexDirection="column">
      <Header
        title="Could not reach OpenRoadie"
        subtitle="The setup wizard drives the real `openroadie` CLI."
      />
      <Text color={palette.red}>{message}</Text>
      <Box marginTop={1}>
        <Text color={palette.dim}>
          Make sure the backend is up (`openroadie status`) and try again.
        </Text>
      </Box>
    </Box>
  );
}

export function IntegrationRow({
  item,
  focused,
  checked,
}: {
  item: Integration;
  focused: boolean;
  checked: boolean;
}) {
  return (
    <Box>
      <Text color={focused ? palette.orange : palette.dim}>
        {focused ? '▶ ' : '  '}
      </Text>
      <Text color={checked ? palette.green : palette.dim}>
        [{checked ? 'x' : ' '}]{' '}
      </Text>
      <Text color={focused ? palette.orange : palette.text} bold={focused}>
        {item.name.padEnd(16, ' ')}
      </Text>
      <Text color={palette.dim}>{item.type.padEnd(20, ' ')}</Text>
      <Text color={palette.dim}>{authLabel(item.authType)}</Text>
    </Box>
  );
}

export function ConnectRow({
  item,
  active,
  connected,
  skipped,
}: {
  item: Integration;
  active: boolean;
  connected: boolean;
  skipped: boolean;
}) {
  const statusMark = connected ? '✓ ' : skipped ? '– ' : '○ ';
  const statusColor = connected ? palette.green : palette.dim;
  return (
    <Box>
      <Text color={active ? palette.orange : palette.dim}>
        {active ? '▶ ' : '  '}
      </Text>
      <Text color={statusColor}>{statusMark}</Text>
      <Text color={active ? palette.orange : palette.text} bold={active}>
        {item.name.padEnd(18, ' ')}
      </Text>
      <Text color={palette.dim}>
        {skipped ? 'skipped' : authLabel(item.authType)}
      </Text>
    </Box>
  );
}

export function CurrentConnect({
  current,
  view,
  isConnected,
  isSkipped,
  complete,
  tokenValue,
  setTokenValue,
  hostValue,
  setHostValue,
  submitHost,
  submitToken,
}: {
  current: Integration;
  view: ConnectView;
  isConnected: boolean;
  isSkipped: boolean;
  complete: boolean;
  tokenValue: string;
  setTokenValue: (value: string) => void;
  hostValue: string;
  setHostValue: (value: string) => void;
  submitHost: (host: string) => void;
  submitToken: (token: string) => void;
}) {
  if (isConnected || isSkipped) {
    const color = isConnected ? palette.green : palette.dim;
    const status = isConnected
      ? '✓ connected (live)'
      : '– skipped (finish it later in the app)';
    const nextMessage = complete
      ? isConnected
        ? 'All set — press Enter to finish.'
        : 'All handled — press Enter to finish.'
      : 'Moving to the next integration…';
    return (
      <Box flexDirection="column">
        <Text color={color}>{status}</Text>
        <Text color={palette.dim}>{nextMessage}</Text>
      </Box>
    );
  }

  if (view.phase === 'working') {
    return (
      <Box flexDirection="column">
        <Text color={palette.orange}>
          <Spinner type="dots" /> Running openroadie connect {current.id}…
        </Text>
      </Box>
    );
  }

  if (view.phase === 'needs-host') {
    return (
      <Box flexDirection="column">
        <Text color={palette.dim}>enter the {current.name} instance URL</Text>
        <Box>
          <Text color={palette.orange}>host: </Text>
          <TextInput
            value={hostValue}
            onChange={value => {
              const cleaned = value.replace(/[\r\n]/g, '');
              if (cleaned !== value) {
                const trimmed = cleaned.trim();
                if (trimmed) {
                  submitHost(trimmed);
                }
                return;
              }
              setHostValue(value);
            }}
            onSubmit={value => {
              const trimmed = value.trim();
              if (trimmed) {
                submitHost(trimmed);
              }
            }}
          />
        </Box>
        {view.message ? <Text color={palette.dim}>{view.message}</Text> : null}
      </Box>
    );
  }

  if (view.phase === 'needs-token' && view.secretName) {
    const secretPosition =
      view.secretNames.length > 1
        ? ` (${view.secretIndex + 1}/${view.secretNames.length})`
        : '';
    return (
      <Box flexDirection="column">
        <Text color={palette.dim}>
          paste {current.name} secret {view.secretName}
          {secretPosition}
        </Text>
        <Box>
          <Text color={palette.orange}>token: </Text>
          <TextInput
            value={tokenValue}
            onChange={value => {
              const cleaned = value.replace(/[\r\n]/g, '');
              if (cleaned !== value) {
                const trimmed = cleaned.trim();
                if (trimmed) {
                  submitToken(trimmed);
                }
                return;
              }
              setTokenValue(value);
            }}
            onSubmit={value => {
              const trimmed = value.trim();
              if (trimmed) {
                submitToken(trimmed);
              }
            }}
            mask="•"
          />
        </Box>
        <Text color={palette.dim}>
          Piped straight to `openroadie secret set {view.secretName}` — never
          stored or printed by setup.
        </Text>
        {view.message ? <Text color={palette.red}>{view.message}</Text> : null}
      </Box>
    );
  }

  if (view.phase === 'app-setup') {
    const intro = view.appSetupOpened
      ? 'Opened your browser at:'
      : 'Open this URL in your browser:';
    return (
      <Box flexDirection="column">
        <Text color={palette.orange}>
          Create and install the GitHub App in OpenRoadie.
        </Text>
        <Text color={palette.dim}>{intro}</Text>
        {view.appSetupUrl ? (
          <Text color={palette.orange}>{view.appSetupUrl}</Text>
        ) : null}
        {view.message ? <Text color={palette.dim}>{view.message}</Text> : null}
        <Text color={palette.dim}>
          GitHub will ask you to confirm and grant repository access.
        </Text>
        <Text color={palette.dim}>
          Press Enter to connect once installed, or Esc to skip for later.
        </Text>
      </Box>
    );
  }

  const tone = view.phase === 'error' ? palette.red : palette.dim;
  return (
    <Box flexDirection="column">
      <Text color={tone}>{view.message ?? 'Not connected yet.'}</Text>
      <Text color={palette.dim}>
        Press Enter to re-run connect {current.id}.
      </Text>
    </Box>
  );
}
