import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  configureIntegrationHost,
  connectIntegration,
  enableIntegration,
  openGithubAppSetupPage,
  setSecret,
} from '../bridge';
import { palette } from '../theme';
import { useFooter } from '../hooks';
import { errorMessage } from '../helpers';
import { ConnectRow, CurrentConnect, Header } from '../components';
import { INITIAL_VIEW, viewFromConnect } from '../types';
import type { ConnectView, FooterHint, Integration } from '../types';

function errorView(message: string): ConnectView {
  return { ...INITIAL_VIEW, phase: 'error', message };
}

export function ConnectStage({
  selectedIntegrations,
  connectedIds,
  setConnectedIds,
  next,
  back,
  setFooterHints,
}: {
  selectedIntegrations: Integration[];
  connectedIds: Set<string>;
  setConnectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  next: () => void;
  back: () => void;
  setFooterHints: React.Dispatch<React.SetStateAction<FooterHint[]>>;
}) {
  const [cursor, setCursor] = useState(0);
  const [tokenValue, setTokenValue] = useState('');
  const [hostValue, setHostValue] = useState('');
  const [view, setView] = useState<ConnectView>(INITIAL_VIEW);
  // Integrations the user chose to leave for later (e.g. a GitHub App that must be
  // installed in the app). They count as "handled" so the stage can complete, but
  // they're never recorded as connected.
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());
  // A monotonically increasing token so a stale async result for a previous
  // integration can't clobber the current one.
  const [runId, setRunId] = useState(0);

  // eslint-disable-next-line security/detect-object-injection -- cursor is bounded local state indexing the in-memory integrations array
  const current = selectedIntegrations[cursor];
  const connectedCount = selectedIntegrations.filter(item =>
    connectedIds.has(item.id),
  ).length;
  // The stage is finished once every selected integration is either connected or
  // explicitly skipped — so a single un-resolvable row (GitHub App install) can't
  // trap the user before the Handoff screen.
  const handledCount = selectedIntegrations.filter(
    item => connectedIds.has(item.id) || skippedIds.has(item.id),
  ).length;
  const complete =
    selectedIntegrations.length > 0 &&
    handledCount === selectedIntegrations.length;
  const isConnected = current ? connectedIds.has(current.id) : false;
  const isSkipped = current ? skippedIds.has(current.id) : false;
  // We're "busy" only while a CLI call is actually in flight for an unresolved
  // integration. Once the current row is connected/skipped there's nothing
  // pending, so Enter (finish / advance) must not be swallowed even though the
  // last view we set was still `working`.
  const busy = view.phase === 'working' && !isConnected && !isSkipped;

  const enterLabel = complete
    ? 'finish'
    : view.phase === 'app-setup'
      ? 'check'
      : 'connect';
  const footer = useMemo(
    () => [
      { key: 'enter', label: enterLabel },
      { key: 'esc', label: view.phase === 'app-setup' ? 'skip' : 'back' },
    ],
    [enterLabel, view.phase],
  );
  useFooter(setFooterHints, footer);

  const advance = useCallback(() => {
    setCursor(value => Math.min(value + 1, selectedIntegrations.length - 1));
  }, [selectedIntegrations.length]);

  const markConnected = useCallback(
    (integration: Integration) => {
      setConnectedIds(currentIds => new Set(currentIds).add(integration.id));
      advance();
    },
    [advance, setConnectedIds],
  );

  // Leave a blocked integration for later and move on (without faking a ✓).
  const skipCurrent = useCallback(
    (integration: Integration) => {
      setSkippedIds(currentIds => new Set(currentIds).add(integration.id));
      advance();
    },
    [advance],
  );

  // When the focused integration changes, kick off the real enable+connect for
  // it (unless it's already connected). A guard via runId discards stale results.
  useEffect(() => {
    if (
      !current ||
      connectedIds.has(current.id) ||
      skippedIds.has(current.id)
    ) {
      return;
    }
    let active = true;
    const myRun = runId;
    setTokenValue('');
    setView(INITIAL_VIEW);

    void (async () => {
      try {
        await enableIntegration(current.id);
        const result = await connectIntegration(current.id);
        if (!active || myRun !== runId) {
          return;
        }
        if (result.connected) {
          markConnected(current);
          return;
        }
        setView(viewFromConnect(result));
      } catch (error) {
        if (!active || myRun !== runId) {
          return;
        }
        setView(errorView(errorMessage(error)));
      }
    })();

    return () => {
      active = false;
    };
    // runId is the explicit retry trigger; current.id moves with the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, runId]);

  const finish = useCallback(() => {
    // The backend at :7008 is the source of truth; `openroadie status`
    // recomputes readiness from live endpoints, so there's nothing to persist.
    next();
  }, [next]);

  const submitHost = useCallback(
    (host: string) => {
      if (!current) {
        return;
      }
      const integration = current;
      setHostValue('');
      setView(INITIAL_VIEW);
      void (async () => {
        try {
          await configureIntegrationHost(integration.id, host);
          const result = await connectIntegration(integration.id);
          if (result.connected) {
            markConnected(integration);
            return;
          }
          setView(viewFromConnect(result));
        } catch (error) {
          setView(errorView(errorMessage(error)));
        }
      })();
    },
    [current, markConnected],
  );

  // Submit a typed token: pipe it to `secret set <NAME>`, then re-connect.
  const submitToken = useCallback(
    (token: string) => {
      if (!current || !view.secretName) {
        return;
      }
      const secretName = view.secretName;
      const secretNames = view.secretNames.length
        ? view.secretNames
        : [secretName];
      const nextSecretIndex = view.secretIndex + 1;
      const integration = current;
      setTokenValue('');
      setView(INITIAL_VIEW);
      void (async () => {
        try {
          await setSecret(secretName, token);
          if (nextSecretIndex < secretNames.length) {
            setView({
              phase: 'needs-token',
              // eslint-disable-next-line security/detect-object-injection -- nextSecretIndex is bounded by the length check above
              secretName: secretNames[nextSecretIndex] ?? null,
              secretNames,
              secretIndex: nextSecretIndex,
              message: null,
              appSetupUrl: null,
              appSetupOpened: false,
            });
            return;
          }
          const result = await connectIntegration(integration.id);
          if (result.connected) {
            markConnected(integration);
            return;
          }
          setView({
            ...viewFromConnect(result),
            message:
              result.reason ??
              'That secret did not connect. Check the token and try again.',
          });
        } catch (error) {
          setView({
            ...errorView(errorMessage(error)),
            secretName,
            secretNames,
            secretIndex: view.secretIndex,
          });
        }
      })();
    },
    [
      current,
      markConnected,
      view.secretIndex,
      view.secretName,
      view.secretNames,
    ],
  );

  // Retry / confirm: re-run connect (with --confirm for OAuth) for the focused
  // integration. Bumping runId re-triggers the effect.
  const retry = useCallback(
    (confirm: boolean) => {
      if (!current) {
        return;
      }
      if (confirm) {
        const integration = current;
        setView(INITIAL_VIEW);
        void (async () => {
          try {
            const result = await connectIntegration(integration.id, true);
            if (result.connected) {
              markConnected(integration);
              return;
            }
            setView({
              ...viewFromConnect(result),
              message:
                view.phase === 'app-setup'
                  ? 'Not linked/installed yet — finish the steps in your browser, then press Enter again.'
                  : result.reason,
            });
          } catch (error) {
            setView(errorView(errorMessage(error)));
          }
        })();
        return;
      }
      setRunId(value => value + 1);
    },
    [current, markConnected, view.phase],
  );

  useEffect(() => {
    if (!current || view.phase !== 'app-setup' || view.appSetupUrl) {
      return;
    }
    const result = openGithubAppSetupPage();
    setView(currentView => ({
      ...currentView,
      appSetupUrl: result.url,
      appSetupOpened: result.opened,
    }));
  }, [current, view.appSetupUrl, view.phase]);

  useInput((_input, key) => {
    if (key.escape) {
      if (view.phase === 'app-setup' && current) {
        skipCurrent(current);
        return;
      }
      back();
      return;
    }
    if (!key.return || busy) {
      return;
    }
    if (complete) {
      finish();
      return;
    }
    if (view.phase === 'app-setup') {
      retry(true);
      return;
    }
    if (view.phase === 'manual' || view.phase === 'error') {
      retry(false);
    }
    // "needs-token" is handled by the TextInput's own onSubmit.
  });

  if (!current) {
    return (
      <Box flexDirection="column">
        <Header
          title="Add Secrets & Connect"
          subtitle="Choose at least one integration first."
        />
        <Text color={palette.orange}>Press Esc to return.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Header
        title="Add Secrets & Connect"
        subtitle={
          skippedIds.size > 0
            ? `${connectedCount}/${selectedIntegrations.length} connected · ${skippedIds.size} skipped`
            : `${connectedCount}/${selectedIntegrations.length} integrations connected`
        }
      />
      <Box flexDirection="column">
        {selectedIntegrations.map(item => (
          <ConnectRow
            key={item.id}
            item={item}
            active={item.id === current.id}
            connected={connectedIds.has(item.id)}
            skipped={skippedIds.has(item.id)}
          />
        ))}
      </Box>

      <Box marginTop={2} flexDirection="column">
        <Text color={palette.white} bold>
          {current.name}
        </Text>
        <CurrentConnect
          current={current}
          view={view}
          isConnected={isConnected}
          isSkipped={isSkipped}
          complete={complete}
          tokenValue={tokenValue}
          setTokenValue={setTokenValue}
          hostValue={hostValue}
          setHostValue={setHostValue}
          submitHost={submitHost}
          submitToken={submitToken}
        />
      </Box>
    </Box>
  );
}
