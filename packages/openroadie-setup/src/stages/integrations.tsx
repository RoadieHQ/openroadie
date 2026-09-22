import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { palette } from '../theme';
import { useFooter, useRevealCount } from '../hooks';
import { Header, IntegrationRow } from '../components';
import type { FooterHint, Integration } from '../types';

export function IntegrationsStage({
  integrations,
  selectedIds,
  setSelectedIds,
  next,
  back,
  setFooterHints,
}: {
  integrations: Integration[];
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  next: () => void;
  back: () => void;
  setFooterHints: React.Dispatch<React.SetStateAction<FooterHint[]>>;
}) {
  const [cursor, setCursor] = useState(0);
  const visible = useRevealCount(integrations.length, 40);
  const footer = useMemo(
    () => [
      { key: '↑↓', label: 'move' },
      { key: 'space', label: 'toggle' },
      { key: 'enter/tab', label: 'continue' },
      { key: 'esc', label: 'back' },
    ],
    [],
  );
  useFooter(setFooterHints, footer);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor(current => Math.max(0, current - 1));
    }
    if (key.downArrow) {
      setCursor(current => Math.min(integrations.length - 1, current + 1));
    }
    if (input === ' ') {
      // eslint-disable-next-line security/detect-object-injection -- cursor is bounded local state indexing the in-memory integrations array
      const item = integrations[cursor];
      if (!item) {
        return;
      }
      setSelectedIds(current => {
        const nextIds = new Set(current);
        if (nextIds.has(item.id)) {
          nextIds.delete(item.id);
        } else {
          nextIds.add(item.id);
        }
        return nextIds;
      });
    }
    if ((key.return || key.tab) && selectedIds.size > 0) {
      next();
    }
    if (key.escape) {
      back();
    }
  });

  return (
    <Box flexDirection="column">
      <Header
        title="Select Integrations"
        subtitle="Choose the systems OpenRoadie should connect. Nothing is auto-detected here."
      />
      <Text color={palette.orange}>
        ▼ {selectedIds.size.toString().padStart(2, '0')}/{integrations.length}{' '}
        selected
      </Text>
      <Box marginTop={1} flexDirection="column">
        {integrations.slice(0, visible).map((item, index) => (
          <IntegrationRow
            key={item.id}
            item={item}
            focused={index === cursor}
            checked={selectedIds.has(item.id)}
          />
        ))}
      </Box>
      {selectedIds.size === 0 ? (
        <Box marginTop={1}>
          <Text color={palette.red}>
            Select at least one integration to continue.
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
