import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithQuery as render } from '../../../test-utils';

import userEvent from '@testing-library/user-event';
import { Input } from '@roadiehq/ui/input';
import { ExampleRelationshipWizard } from './example-relationship-wizard';
import type { DataSourceItem } from '../types';

vi.mock('../../integrations/use-integrations', () => ({
  useIntegrations: () => ({
    integrations: [{ id: 'github', name: 'GitHub (Token)' }],
    logoDataUriBySlug: new Map(),
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../common/integration-selector', () => ({
  IntegrationSelector: ({
    selectedIntegrationId,
    onSelect,
    label,
  }: {
    selectedIntegrationId?: string;
    onSelect: (integration: { id: string; backendType: 'http' }) => void;
    label?: string;
  }) => (
    <Input
      aria-label={label ?? 'Integration'}
      value={selectedIntegrationId ?? ''}
      onChange={event =>
        onSelect({ id: event.target.value, backendType: 'http' })
      }
    />
  ),
}));

const sourceObject = {
  id: 'row-1',
  datasourceId: 'ds-1',
  objectId: 'obj-1',
  object: { name: 'Service', ownerEmail: 'alice@example.com' },
  relationships: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const targetObject = {
  id: 'row-2',
  datasourceId: 'ds-1',
  objectId: 'obj-2',
  object: { name: 'Alice', email: 'alice@example.com' },
  relationships: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockDatastoreApi = {
  listIndexConfigurations: vi.fn(),
  queryObjects: vi.fn(),
  searchObjects: vi.fn(),
  getObject: vi.fn(),
  inferExampleRelationshipPattern: vi.fn(),
  listDatasourceSchemas: vi.fn(),
  listRelationshipRules: vi.fn(),
  previewRelationshipRule: vi.fn(),
  createRelationshipRule: vi.fn(),
  applyRelationshipRule: vi.fn(),
};

vi.mock('../../../api', () => ({
  useDatastore: () => mockDatastoreApi,
  useAlert: () => ({ post: vi.fn() }),
}));

const dataSources = [
  // Only the fields the wizard reads are set.
  { id: 'ds-1', name: 'People and Services', nodes: [] },
] as unknown as DataSourceItem[];

beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockDatastoreApi.listIndexConfigurations.mockResolvedValue([]);
  mockDatastoreApi.queryObjects.mockResolvedValue({
    total: 2,
    items: [sourceObject, targetObject],
  });
  mockDatastoreApi.searchObjects.mockResolvedValue({
    total: 2,
    items: [sourceObject, targetObject],
  });
  mockDatastoreApi.getObject.mockImplementation(
    async (_datasourceId: string, objectId: string) =>
      objectId === 'obj-1' ? sourceObject : targetObject,
  );
  mockDatastoreApi.inferExampleRelationshipPattern.mockResolvedValue({
    candidates: [
      {
        sourceFieldExpression: '$.ownerEmail',
        targetFieldExpression: '$.email',
        matchedValue: 'alice@example.com',
        score: 0.91,
      },
    ],
  });
  mockDatastoreApi.listDatasourceSchemas.mockResolvedValue({
    items: [],
    total: 0,
  });
  mockDatastoreApi.listRelationshipRules.mockResolvedValue({
    items: [],
    total: 0,
  });
  mockDatastoreApi.previewRelationshipRule.mockResolvedValue({
    total: 1,
    items: [
      {
        sourceObjectId: 'obj-1',
        relationshipType: 'dependsOn',
        targetObjectIds: ['obj-2'],
        sourceValue: 'alice@example.com',
        targetValue: 'alice@example.com',
        targetLabels: ['Alice'],
      },
    ],
  });
  mockDatastoreApi.createRelationshipRule.mockResolvedValue({
    id: 'rule-1',
    sourceDatasourceId: 'ds-1',
    targetDatasourceId: 'ds-1',
    sourceFieldExpression: '$.ownerEmail',
    targetFieldExpression: '$.email',
    relationshipType: 'dependsOn',
    matchStrategy: 'exact',
    state: 'active',
    origin: 'manual',
  });
  mockDatastoreApi.applyRelationshipRule.mockResolvedValue({
    created: 1,
    deleted: 0,
  });
});

function renderWizard(overrides: { dataSources?: DataSourceItem[] } = {}) {
  return render(
    <ExampleRelationshipWizard
      open
      onOpenChange={vi.fn()}
      dataSources={overrides.dataSources ?? dataSources}
      sourceDatasourceId="ds-1"
      sourceObjectId="obj-1"
    />,
  );
}

async function pickTargetAndInfer(user: ReturnType<typeof userEvent.setup>) {
  const targetButtons = await screen.findAllByRole('button', {
    name: /obj-2/i,
  });
  await user.click(targetButtons[targetButtons.length - 1]!);
  const proposeButtons = screen.getAllByRole('button', {
    name: /propose pattern/i,
  });
  await user.click(proposeButtons[proposeButtons.length - 1]!);
}

describe('ExampleRelationshipWizard', () => {
  it('wires inferred fields into preview and create/apply save', async () => {
    const user = userEvent.setup();
    renderWizard();

    await pickTargetAndInfer(user);

    expect(
      await screen.findByText('$.ownerEmail', { exact: false }),
    ).toBeInTheDocument();
    expect(
      mockDatastoreApi.inferExampleRelationshipPattern,
    ).toHaveBeenCalledWith({
      sourceDatasourceId: 'ds-1',
      sourceObjectId: 'obj-1',
      targetDatasourceId: 'ds-1',
      targetObjectId: 'obj-2',
    });

    // Candidates are opt-in: Review is gated until one is picked.
    const reviewButtons = screen.getAllByRole('button', {
      name: /review matches/i,
    });
    expect(reviewButtons[reviewButtons.length - 1]).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /\$\.ownerEmail/i }));
    await user.click(reviewButtons[reviewButtons.length - 1]!);

    await waitFor(
      () =>
        expect(mockDatastoreApi.previewRelationshipRule).toHaveBeenCalledWith(
          expect.objectContaining({
            sourceFieldExpression: '$.ownerEmail',
            targetFieldExpression: '$.email',
          }),
          { limit: 25 },
        ),
      { timeout: 1500 },
    );
    expect(await screen.findByText('example')).toBeInTheDocument();

    const createButton = screen.getByRole('button', {
      name: /create rule & apply/i,
    });
    await waitFor(() => expect(createButton).toBeEnabled(), {
      timeout: 1500,
    });
    await user.click(createButton);

    await waitFor(() =>
      expect(mockDatastoreApi.createRelationshipRule).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceFieldExpression: '$.ownerEmail',
          targetFieldExpression: '$.email',
          origin: 'manual',
        }),
      ),
    );
    expect(mockDatastoreApi.applyRelationshipRule).toHaveBeenCalledWith(
      'rule-1',
    );
  });

  it('defaults the target to a different data source than the source', async () => {
    renderWizard({
      dataSources: [
        { id: 'ds-1', name: 'People and Services', nodes: [] },
        { id: 'ds-2', name: 'Teams', nodes: [] },
      ] as unknown as DataSourceItem[],
    });

    const targetPickers = await screen.findAllByRole('combobox', {
      name: /target data source/i,
    });
    for (const picker of targetPickers) {
      expect(picker).toHaveValue('Teams');
    }
  });

  it('creates one rule per selected candidate pair', async () => {
    mockDatastoreApi.inferExampleRelationshipPattern.mockResolvedValue({
      candidates: [
        {
          sourceFieldExpression: '$.ownerEmail',
          targetFieldExpression: '$.email',
          matchedValue: 'alice@example.com',
          score: 0.91,
        },
        {
          sourceFieldExpression: '$.name',
          targetFieldExpression: '$.team',
          matchedValue: 'Service',
          score: 0.55,
        },
      ],
    });
    const user = userEvent.setup();
    renderWizard();

    await pickTargetAndInfer(user);
    await user.click(
      await screen.findByRole('button', { name: /\$\.ownerEmail/i }),
    );
    await user.click(screen.getByRole('button', { name: /\$\.name/i }));

    const reviewButtons = screen.getAllByRole('button', {
      name: /review matches/i,
    });
    await user.click(reviewButtons[reviewButtons.length - 1]!);

    const createButton = await screen.findByRole('button', {
      name: /create 2 rules & apply/i,
    });
    await waitFor(() => expect(createButton).toBeEnabled(), {
      timeout: 1500,
    });
    await user.click(createButton);

    await waitFor(() =>
      expect(mockDatastoreApi.createRelationshipRule).toHaveBeenCalledTimes(2),
    );
    expect(mockDatastoreApi.createRelationshipRule).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFieldExpression: '$.ownerEmail',
        targetFieldExpression: '$.email',
      }),
    );
    expect(mockDatastoreApi.createRelationshipRule).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFieldExpression: '$.name',
        targetFieldExpression: '$.team',
      }),
    );
    expect(mockDatastoreApi.applyRelationshipRule).toHaveBeenCalledTimes(2);
  });

  it('runs integration preview then enables create for integration-backed rules', async () => {
    const user = userEvent.setup();
    renderWizard();

    await pickTargetAndInfer(user);
    await user.click(screen.getByRole('button', { name: /\$\.ownerEmail/i }));
    await user.click(
      screen.getAllByRole('button', { name: /review matches/i }).at(-1)!,
    );

    await user.click(screen.getByRole('radio', { name: 'Integration lookup' }));

    await user.type(screen.getByLabelText('Integration'), 'github');
    fireEvent.change(screen.getByLabelText('Request path'), {
      target: { value: '/users/{value}/teams' },
    });
    await user.click(screen.getByRole('button', { name: 'Response' }));
    fireEvent.change(screen.getByLabelText('Response field'), {
      target: { value: '$.teams[*].slug' },
    });

    const createButton = screen.getByRole('button', {
      name: /create rule & apply/i,
    });
    expect(createButton).toBeDisabled();
    expect(
      screen.getByText(/Create is available after you run a preview/i),
    ).toBeInTheDocument();

    await user.click(await screen.findByText('Run preview'));
    await waitFor(() =>
      expect(mockDatastoreApi.previewRelationshipRule).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'integration-backed',
          integrationConfig: expect.objectContaining({
            integrationId: 'github',
            path: '/users/{value}/teams',
            responseMatchExpression: '$.teams[*].slug',
          }),
        }),
        { sampleLimit: 5 },
      ),
    );

    await waitFor(() => expect(createButton).toBeEnabled(), { timeout: 1500 });
    await user.click(createButton);

    await waitFor(() =>
      expect(mockDatastoreApi.createRelationshipRule).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: 'integration-backed',
          integrationConfig: expect.objectContaining({
            integrationId: 'github',
          }),
        }),
      ),
    );
  });

  it('disables candidates already covered by an existing rule', async () => {
    mockDatastoreApi.listRelationshipRules.mockResolvedValue({
      total: 1,
      items: [
        {
          id: 'existing-rule',
          name: 'existing',
          sourceDatasourceId: 'ds-1',
          targetDatasourceId: 'ds-1',
          sourceFieldExpression: '$.ownerEmail',
          targetFieldExpression: '$.email',
          relationshipType: 'dependsOn',
          strategy: 'field-matching',
          matchStrategy: 'exact',
          state: 'active',
          origin: 'manual',
        },
      ],
    });
    const user = userEvent.setup();
    renderWizard();

    await pickTargetAndInfer(user);

    const candidateButton = await screen.findByRole('button', {
      name: /\$\.ownerEmail/i,
    });
    expect(candidateButton).toBeDisabled();
    expect(candidateButton).toHaveTextContent(/rule exists/i);
  });
});
