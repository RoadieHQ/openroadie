import React, { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { palette } from '../theme';
import { useFooter, useRevealCount } from '../hooks';
import type { FooterHint } from '../types';

export function WelcomeStage({
  next,
  setFooterHints,
}: {
  next: () => void;
  setFooterHints: React.Dispatch<React.SetStateAction<FooterHint[]>>;
}) {
  const visible = useRevealCount(3, 150);
  const footer = useMemo(() => [{ key: 'enter/tab', label: 'begin' }], []);
  useFooter(setFooterHints, footer);

  useInput((_input, key) => {
    if (key.return || key.tab) {
      next();
    }
  });

  return (
    <Box flexDirection="column" marginTop={2}>
      <Text color={palette.orange} bold>
        OPENROADIE SETUP
      </Text>
      <Box marginTop={1} flexDirection="column">
        {visible >= 1 ? (
          <Text color={palette.text}>
            OpenRoadie maps how your services, repos, on-call and tickets
            connect —
          </Text>
        ) : null}
        {visible >= 1 ? (
          <Text color={palette.text}>
            so an agent can answer "what breaks if payments-api goes down?"
          </Text>
        ) : null}
        {visible >= 2 ? (
          <Box marginTop={1}>
            <Text color={palette.dim}>
              This is the human-owned front half: pick integrations, add
              secrets, connect.
            </Text>
          </Box>
        ) : null}
        {visible >= 3 ? (
          <Text color={palette.dim}>
            An agent builds the graph next. Your tokens stay here — it never
            sees them.
          </Text>
        ) : null}
        {visible >= 3 ? (
          <Box marginTop={1}>
            <Text color={palette.orange}>▶ Press Enter or Tab to begin</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
