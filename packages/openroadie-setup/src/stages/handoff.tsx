import React, { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { palette } from '../theme';
import { useFooter } from '../hooks';
import type { FooterHint } from '../types';

export function HandoffStage({
  connectedCount,
  selectedCount,
  exit,
  setFooterHints,
}: {
  connectedCount: number;
  selectedCount: number;
  exit: () => void;
  setFooterHints: React.Dispatch<React.SetStateAction<FooterHint[]>>;
}) {
  const footer = useMemo(() => [{ key: 'enter/q', label: 'exit' }], []);
  useFooter(setFooterHints, footer);

  useInput((input, key) => {
    if (key.return || input === 'q') {
      exit();
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={palette.green} bold>
        ✓ Connected {connectedCount} of {selectedCount} integrations · catalog
        ready to build.
      </Text>
      <Box marginTop={2} flexDirection="column">
        <Text color={palette.white} bold>
          Now an agent builds your graph — run:
        </Text>
        <Text color={palette.orange}>openroadie agent</Text>
        <Text color={palette.dim}>
          or give your coding agent the install skill, then tell it "finish
          setting up openroadie":
        </Text>
        <Text color={palette.orange}>npx skills add RoadieHQ/skills</Text>
      </Box>
      <Box marginTop={2}>
        <Text color={palette.dim}>
          Your tokens stay here in setup — the agent never sees them.
        </Text>
      </Box>
      <Box marginTop={2}>
        <Text color={palette.orange}>▶ Press Enter or q to exit</Text>
      </Box>
    </Box>
  );
}
