import React, { useEffect, useState } from 'react';
import { useApp, useInput } from 'ink';
import { listIntegrations } from './bridge';
import { Layout, Loading, LoadError } from './components';
import { WelcomeStage } from './stages/welcome';
import { IntegrationsStage } from './stages/integrations';
import { ConnectStage } from './stages/connect';
import { HandoffStage } from './stages/handoff';
import { defaultIds, stages } from './types';
import type { FooterHint, Integration } from './types';

export function App() {
  const { exit } = useApp();
  const [stageIndex, setStageIndex] = useState(0);
  const [footerHints, setFooterHints] = useState<FooterHint[]>([]);
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [connectedIds, setConnectedIds] = useState<Set<string>>(
    () => new Set(),
  );
  // eslint-disable-next-line security/detect-object-injection -- stageIndex is bounded React state into the module-const `stages` array
  const stage = stages[stageIndex] ?? 'Welcome';

  useEffect(() => {
    let active = true;
    listIntegrations()
      .then(list => {
        if (!active) {
          return;
        }
        setIntegrations(list);
        setSelectedIds(
          new Set(
            list.filter(item => defaultIds.has(item.id)).map(item => item.id),
          ),
        );
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, []);

  const next = () =>
    setStageIndex(current => Math.min(stages.length - 1, current + 1));
  const back = () => setStageIndex(current => Math.max(0, current - 1));

  useInput(input => {
    if (input === 'q') {
      exit();
    }
  });

  const selectedIntegrations = (integrations ?? []).filter(integration =>
    selectedIds.has(integration.id),
  );

  let body: React.ReactNode;
  if (stage === 'Welcome') {
    body = <WelcomeStage next={next} setFooterHints={setFooterHints} />;
  } else if ((stage === 'Integrations' || stage === 'Connect') && loadError) {
    body = <LoadError message={loadError} />;
  } else if (
    (stage === 'Integrations' || stage === 'Connect') &&
    !integrations
  ) {
    body = <Loading />;
  } else if (stage === 'Integrations' && integrations) {
    body = (
      <IntegrationsStage
        integrations={integrations}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        next={next}
        back={back}
        setFooterHints={setFooterHints}
      />
    );
  } else if (stage === 'Connect' && integrations) {
    body = (
      <ConnectStage
        selectedIntegrations={selectedIntegrations}
        connectedIds={connectedIds}
        setConnectedIds={setConnectedIds}
        next={next}
        back={back}
        setFooterHints={setFooterHints}
      />
    );
  } else {
    body = (
      <HandoffStage
        connectedCount={
          selectedIntegrations.filter(item => connectedIds.has(item.id)).length
        }
        selectedCount={selectedIntegrations.length}
        exit={exit}
        setFooterHints={setFooterHints}
      />
    );
  }

  return (
    <Layout stageIndex={stageIndex} footerHints={footerHints}>
      {body}
    </Layout>
  );
}
