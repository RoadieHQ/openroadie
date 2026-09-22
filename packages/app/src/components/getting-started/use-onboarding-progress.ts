import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Blocks,
  Database,
  Share2,
  Sparkles,
  Users,
  Waypoints,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  useCapabilities as useCapabilitiesApi,
  useDatastore,
  useFeatureFlag,
  useWorkflows,
} from '../../api';
import {
  capabilitiesListQuery,
  contextGroupRulesQuery,
  dataIngestionWorkflowsQuery,
  integrationsListQuery,
  objectCountsQuery,
  relationshipRulesQuery,
} from '../../api/queries';
import { PATHS } from '../../config/paths';
import { useIntegrationSecretStatus } from '../integrations/use-integration-secret-status';

export type OnboardingStepId =
  | 'integration'
  | 'dataSource'
  | 'ingest'
  | 'relationship'
  | 'contextGroup'
  | 'capability';

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  /** One-line explanation of what the step accomplishes. */
  description: string;
  icon: LucideIcon;
  done: boolean;
  cta: { label: string; to: string };
}

export interface OnboardingProgress {
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  /** Every visible step is done. */
  complete: boolean;
  /** True until the underlying queries have resolved at least once. */
  loading: boolean;
}

const NEW_CAPABILITY_PATH = `${PATHS.CAPABILITIES}/new`;

/**
 * Derives first-run onboarding progress entirely from live query state — each
 * step's "done" is computed from real data (an integration is configured, a
 * data source is enabled, objects exist, …) so it's always accurate and
 * self-heals; nothing is persisted. All reads go through the shared `queryKeys`
 * factories, so this adds no network cost when the pages/sidebar have already
 * loaded them.
 */
export function useOnboardingProgress(): OnboardingProgress {
  const workflowApi = useWorkflows();
  const datastore = useDatastore();
  const capabilitiesApi = useCapabilitiesApi();
  const { value: relationshipsEnabled } = useFeatureFlag('relationships', true);

  const integrationsQuery = useQuery(integrationsListQuery(workflowApi));
  const integrations = useMemo(
    () => integrationsQuery.data?.data ?? [],
    [integrationsQuery.data],
  );
  const { summariesByIntegrationId, loading: secretStatusLoading } =
    useIntegrationSecretStatus(integrations);

  const workflowsQuery = useQuery(dataIngestionWorkflowsQuery(workflowApi));
  const workflows = useMemo(
    () => workflowsQuery.data?.data ?? [],
    [workflowsQuery.data],
  );
  const workflowIds = useMemo(() => workflows.map(w => w.id), [workflows]);

  const objectCountsQ = useQuery({
    ...objectCountsQuery(datastore, workflowIds),
    enabled: workflowIds.length > 0,
  });

  const relationshipsQuery = useQuery({
    // A count-only probe (limit 1 → its own cache entry, cheap); we only need
    // to know whether any rule exists. Skipped when the feature is off.
    ...relationshipRulesQuery(datastore, 1),
    enabled: relationshipsEnabled,
  });
  const contextGroupsQuery = useQuery(contextGroupRulesQuery(datastore));
  const capabilitiesQuery = useQuery(capabilitiesListQuery(capabilitiesApi));

  return useMemo(() => {
    const integrationDone = Array.from(summariesByIntegrationId.values()).some(
      summary => summary.configured,
    );
    const dataSourceDone = workflows.some(workflow => workflow.enabled);
    const ingestDone = (objectCountsQ.data ?? []).some(
      entry => entry.count > 0,
    );
    const relationshipDone = (relationshipsQuery.data?.total ?? 0) > 0;
    const contextGroupDone = (contextGroupsQuery.data?.total ?? 0) > 0;
    const capabilityDone = (capabilitiesQuery.data?.total ?? 0) > 0;

    const steps: OnboardingStep[] = [
      {
        id: 'integration',
        title: 'Connect an integration',
        description:
          'Add a system and its secret. Turn on auto-enable and its data sources appear for you.',
        icon: Blocks,
        done: integrationDone,
        cta: { label: 'Connect an integration', to: PATHS.INTEGRATIONS },
      },
      {
        id: 'dataSource',
        title: 'Add data sources',
        description:
          'Enable an ingestion workflow. Connecting an integration above can do this automatically.',
        icon: Share2,
        done: dataSourceDone,
        cta: { label: 'Go to data sources', to: PATHS.DATA_SOURCES },
      },
      {
        id: 'ingest',
        title: 'Ingest data',
        description: 'Run a data source to pull objects into your datastore.',
        icon: Database,
        done: ingestDone,
        cta: { label: 'Run a data source', to: PATHS.DATA_SOURCES },
      },
      ...(relationshipsEnabled
        ? [
            {
              id: 'relationship' as const,
              title: 'Link objects with relationships',
              description:
                'Connect objects across data sources. Enabling a data source seeds these for you.',
              icon: Waypoints,
              done: relationshipDone,
              cta: { label: 'View relationships', to: PATHS.RELATIONSHIPS },
            },
            {
              id: 'contextGroup' as const,
              title: 'Create a context group',
              description:
                'Layer a cross-cutting business concept over the object graph. Also seeded automatically.',
              icon: Users,
              done: contextGroupDone,
              cta: {
                label: 'Create a context group',
                to: PATHS.CONTEXT_GROUPS,
              },
            },
          ]
        : []),
      {
        id: 'capability',
        title: 'Create a capability',
        description:
          'Write a reusable agent playbook grounded in everything above.',
        icon: Sparkles,
        done: capabilityDone,
        cta: { label: 'Create a capability', to: NEW_CAPABILITY_PATH },
      },
    ];

    const completedCount = steps.filter(step => step.done).length;

    const loading =
      integrationsQuery.isLoading ||
      secretStatusLoading ||
      workflowsQuery.isLoading ||
      objectCountsQ.isLoading ||
      relationshipsQuery.isLoading ||
      contextGroupsQuery.isLoading ||
      capabilitiesQuery.isLoading;

    return {
      steps,
      completedCount,
      totalCount: steps.length,
      complete: completedCount === steps.length,
      loading,
    };
  }, [
    summariesByIntegrationId,
    workflows,
    objectCountsQ.data,
    objectCountsQ.isLoading,
    relationshipsQuery.data,
    relationshipsQuery.isLoading,
    contextGroupsQuery.data,
    contextGroupsQuery.isLoading,
    capabilitiesQuery.data,
    capabilitiesQuery.isLoading,
    relationshipsEnabled,
    integrationsQuery.isLoading,
    secretStatusLoading,
    workflowsQuery.isLoading,
  ]);
}
