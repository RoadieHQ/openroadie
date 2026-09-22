import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiContext } from '../../../api/context';
import type { ApiClients } from '../../../api/context';
import type {
  RelationshipRule,
  RelationshipRulePreviewResult,
} from '../../../api/datastore/datastore-client';
import { RelationshipRuleInspector } from './relationship-rule-inspector';
import { queryKeys } from '../../../api/queries';
import { workspaceQueryKey } from '../../../api/workspace-scope';
import type { SchemaField } from './schema-field-utils';

// ---------------------------------------------------------------------------
// Iterate on the rule editor's density here without the graph or a backend.
// Everything the editor fetches is either passed in as a prop (onPreview) or
// pre-seeded into the query cache below, so the stub API clients are never
// actually called.
// ---------------------------------------------------------------------------

const logoDataUri = (hex: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="${hex}"/></svg>`,
  )}`;

const SOURCE_LOGO = logoDataUri('#6366f1');
const TARGET_LOGO = logoDataUri('#22c55e');

const RULE: RelationshipRule = {
  id: 'rule-1',
  name: 'K8s Pods → GitHub Users',
  description: null,
  sourceDatasourceId: 'src-ds',
  targetDatasourceId: 'tgt-ds',
  sourceFieldExpression: '$.metadata.annotations.owner',
  targetFieldExpression: '$.login',
  sourceFilterExpression: null,
  targetFilterExpression: null,
  relationshipType: 'ownedBy',
  reciprocalRelationshipType: 'owns',
  strategy: 'field-matching',
  matchStrategy: 'exact',
  origin: 'manual',
  state: 'active',
  suggestionKind: null,
  score: null,
  confidenceBand: null,
  evidenceSummary: null,
  reviewReason: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// Integration-backed variant — adds the Lookup stage, so the Match row shows
// the full 3-card chain (source → lookup → target). Integration lookups are
// manual, so click "Run preview" in the story to populate the sample chain.
const INTEGRATION_RULE: RelationshipRule = {
  ...RULE,
  id: 'rule-2',
  name: 'GitHub Team Members → GitHub Teams',
  strategy: 'integration-backed',
  integrationConfig: {
    integrationId: 'github',
    method: 'GET',
    path: '/users/{value}/teams',
    responseMatchExpression: '$.teams[*].slug',
  },
};

// Suggested rule with full evidence, including a waterfall, gate, and a
// rescue — exercises every section the evidence badge can render (see
// suggestion-evidence-badge.test.tsx for the same fixtures split out).
const SUGGESTED_RULE: RelationshipRule = {
  ...RULE,
  id: 'rule-suggested',
  name: 'Email → Email (suggested)',
  sourceFieldExpression: '$.email',
  targetFieldExpression: '$.mail',
  relationshipType: 'sameIdentityAs',
  reciprocalRelationshipType: null,
  origin: 'suggested',
  state: 'suggested',
  suggestionKind: 'identity',
  score: 0.87,
  confidenceBand: 'high',
  reviewReason: 'Low row coverage on the target field',
  evidenceSummary: {
    valueTypes: ['email'],
    distinctMatchedValueCount: 42,
    sourceFieldStats: {
      distinctCount: 50,
      rowCoverage: 0.98,
      cardinalityRatio: 0.9,
      looksEnumLike: false,
      isIdentifierLike: true,
    },
    targetFieldStats: {
      distinctCount: 44,
      rowCoverage: 0.6,
      cardinalityRatio: 0.8,
      looksEnumLike: false,
      isIdentifierLike: true,
    },
    commonValuePenalty: -0.1,
    topMatchedValues: ['a@x.io', 'b@x.io'],
    explanation: 'Emails on both sides match with high coverage.',
    waterfall: [
      { signal: 'prior', fired: true, weight: -5 },
      {
        signal: 'containment-high',
        fired: true,
        weight: 2.145,
        detail: 'containment 0.99',
      },
      { signal: 'name-similarity', fired: true, weight: 0.585 },
      { signal: 'value-rarity', fired: true, weight: 0.263 },
    ],
    gate: {
      containment: 0.99,
      containmentDirection: 'source-to-target',
      containmentVerified: true,
      referencedCardinalityRatio: 0.94,
    },
    rescue: {
      kind: 'transform',
      detail: 'lower(trim($.email))',
      originalField: '$.email',
    },
  },
};

const SOURCE_FIELDS: SchemaField[] = [
  { name: '$.metadata.name', type: 'string' },
  { name: '$.metadata.annotations.owner', type: 'string' },
  { name: '$.spec.replicas', type: 'number' },
];

const TARGET_FIELDS: SchemaField[] = [
  { name: '$.login', type: 'string' },
  { name: '$.id', type: 'number' },
  { name: '$.company', type: 'string' },
];

const PREVIEW_RESULT: RelationshipRulePreviewResult = {
  total: 3,
  items: [
    {
      sourceObjectId: 'src-1',
      relationshipType: 'ownedBy',
      targetObjectIds: ['tgt-1'],
      sourceValue: 'octocat',
      targetValue: 'octocat',
      matchSourceValues: ['octocat'],
      matchTargetValues: ['octocat'],
      sourceLabel: 'checkout-pod',
      targetLabels: ['octocat'],
    },
    {
      sourceObjectId: 'src-2',
      relationshipType: 'ownedBy',
      targetObjectIds: ['tgt-2'],
      sourceValue: 'monalisa',
      targetValue: 'monalisa',
      matchSourceValues: ['monalisa'],
      matchTargetValues: ['monalisa'],
      sourceLabel: 'billing-pod',
      targetLabels: ['monalisa'],
    },
    {
      sourceObjectId: 'src-3',
      relationshipType: 'ownedBy',
      targetObjectIds: [],
      sourceValue: 'ghost',
      sourceLabel: 'orphan-pod',
    },
  ],
};

const SAMPLE_OBJECTS: Record<string, { object: Record<string, unknown> }> = {
  'src-1': {
    object: { name: 'checkout-pod', namespace: 'payments', owner: 'octocat' },
  },
  'tgt-1': { object: { login: 'octocat', id: 583231, company: '@github' } },
};

const mockApis = {
  config: {
    app: { title: 'Storybook', baseUrl: '' },
    backend: { baseUrl: '' },
  } as ApiClients['config'],
  workflows: {} as ApiClients['workflows'],
  datastore: {} as ApiClients['datastore'],
  alert: {} as ApiClients['alert'],
} as ApiClients;

function makeSeededClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // Catalog reads used by the config step (integration list / logos) — empty is
  // fine, it just means no integration options. Seeding keeps the stub client
  // from ever being called.
  client.setQueryData(queryKeys.logos, []);
  client.setQueryData(queryKeys.integrationsList, { data: [] });
  client.setQueryData(queryKeys.dataIngestionWorkflows, { data: [] });
  // Sample-object reads for each matched source/target in the preview chain.
  for (const [id, value] of Object.entries(SAMPLE_OBJECTS)) {
    const dsId = id.startsWith('src')
      ? RULE.sourceDatasourceId
      : RULE.targetDatasourceId;
    client.setQueryData(
      workspaceQueryKey('relationship-sample-object', dsId, id),
      value,
    );
  }
  // Independent fallback sample (a card before a preview matches an object).
  client.setQueryData(
    workspaceQueryKey('relationship-sample-fallback', RULE.sourceDatasourceId),
    { items: [SAMPLE_OBJECTS['src-1']] },
  );
  client.setQueryData(
    workspaceQueryKey('relationship-sample-fallback', RULE.targetDatasourceId),
    { items: [SAMPLE_OBJECTS['tgt-1']] },
  );
  return client;
}

const meta = {
  title: 'DataSources/RelationshipRuleInspector',
  component: RelationshipRuleInspector,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    Story => {
      const [client] = useState(makeSeededClient);
      return (
        <QueryClientProvider client={client}>
          <ApiContext.Provider value={mockApis}>
            <Story />
          </ApiContext.Provider>
        </QueryClientProvider>
      );
    },
  ],
  args: {
    open: true,
    // Required by the component; null renders into the default portal target.
    // Stories that need a real element (the drawer harness) override it.
    container: null,
    sourceDatasourceId: RULE.sourceDatasourceId,
    targetDatasourceId: RULE.targetDatasourceId,
    sourceLabel: 'K8s Pods',
    targetLabel: 'GitHub Users',
    sourceLogoUrl: SOURCE_LOGO,
    targetLogoUrl: TARGET_LOGO,
    sourceFields: SOURCE_FIELDS,
    targetFields: TARGET_FIELDS,
    existingRule: RULE,
    existingRules: [RULE],
    onClose: fn(),
    onSave: fn(),
    onDelete: fn(),
    onPreview: async () => PREVIEW_RESULT,
  },
} satisfies Meta<typeof RelationshipRuleInspector>;

export default meta;
type Story = StoryObj<typeof meta>;

// The drawer variant portals into a container and measures its height, so it
// needs a real element ref — hence a component (not an inline render closure).
function DrawerHarness(
  args: React.ComponentProps<typeof RelationshipRuleInspector>,
) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setContainer} className="relative h-screen w-full bg-background">
      {container && (
        <RelationshipRuleInspector
          {...args}
          variant="drawer"
          container={container}
          standaloneHref="/relationships/rules/rule-1/edit"
        />
      )}
    </div>
  );
}

/**
 * The floating drawer variant as it appears over the relationships graph —
 * compact `DrawerPanelHeader` with the centered source → target summary.
 */
export const Drawer: Story = {
  render: args => <DrawerHarness {...args} />,
};

/**
 * Integration-backed rule: the pipeline gains a Lookup stage, so the Match row
 * shows the full 3-card chain (source → lookup → target). Lookups are manual —
 * click "Run preview" to populate the sample chain.
 */
export const IntegrationBackedDrawer: Story = {
  args: {
    existingRule: INTEGRATION_RULE,
    existingRules: [INTEGRATION_RULE],
  },
  render: args => <DrawerHarness {...args} />,
};

/**
 * The full-page variant used by the standalone edit route — no drawer chrome,
 * the source → target row renders inline above the configuration.
 */
export const Page: Story = {
  render: args => (
    <div className="h-screen w-full bg-background p-4">
      <RelationshipRuleInspector
        {...args}
        variant="page"
        container={null}
        showHeader={false}
      />
    </div>
  ),
};

/**
 * Review mode for a suggested rule — "Review Suggested Rule" title, the
 * evidence panel above the pipeline, and the Approve action.
 */
export const SuggestedRule: Story = {
  args: {
    existingRule: SUGGESTED_RULE,
    existingRules: [SUGGESTED_RULE],
    onApprove: fn(),
  },
  render: args => <DrawerHarness {...args} />,
};
