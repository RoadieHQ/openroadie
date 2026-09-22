import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinition } from '@roadiehq/catalog-workflow-common';
import type { ContextGroupRule } from './types';
import { ContextGroupDao } from './ContextGroupDao';

function makeWorkflow(id: string, name: string): WorkflowDefinition {
  return {
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, '-'),
    enabled: true,
    nodes: [
      {
        id: `source-${id}`,
        type: 'source-datastore',
        data: { config: { datasourceId: id } },
      },
    ],
  } as unknown as WorkflowDefinition;
}

function makeRule(overrides: Partial<ContextGroupRule> = {}): ContextGroupRule {
  return {
    id: 'rule-1',
    name: 'Rule 1',
    slug: 'rule-1',
    description: null,
    datasources: [],
    mergeRelationshipTypes: [],
    annotations: [],
    includeExternalRelations: true,
    seedVersion: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ContextGroupDao enrichment', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses one workflow lookup for all datasources on a single rule', async () => {
    const dao = new ContextGroupDao({
      knex: {} as any,
      catalogWorkflowClient: {} as any,
    });
    const rule = makeRule({
      datasources: [{ seedName: 'Seed One' }, { seedName: 'Seed Two' }],
    });

    const listAllWorkflows = vi
      .spyOn(dao as any, 'listAllWorkflows')
      .mockResolvedValue([
        makeWorkflow('ds-1', 'Seed One'),
        makeWorkflow('ds-2', 'Seed Two'),
      ]);
    const listIntegrations = vi
      .spyOn(dao as any, 'listIntegrations')
      .mockResolvedValue(new Map());
    const getDatasourcePresence = vi
      .spyOn(dao as any, 'getDatasourcePresence')
      .mockResolvedValue(
        new Map([
          ['ds-1', { hasActivity: true, objectCount: 1 }],
          ['ds-2', { hasActivity: true, objectCount: 1 }],
        ]),
      );

    const enriched = await dao.enrichRule(rule);

    expect(listAllWorkflows).toHaveBeenCalledTimes(1);
    expect(listIntegrations).toHaveBeenCalledTimes(1);
    expect(getDatasourcePresence).toHaveBeenCalledTimes(1);
    expect(enriched.datasources[0].status).toEqual(
      expect.objectContaining({ live: true, datasourceId: 'ds-1' }),
    );
    expect(enriched.datasources[1].status).toEqual(
      expect.objectContaining({ live: true, datasourceId: 'ds-2' }),
    );
  });

  it('reuses one workflow lookup across multiple rules in enrichRules', async () => {
    const dao = new ContextGroupDao({
      knex: {} as any,
      catalogWorkflowClient: {} as any,
    });
    const ruleOne = makeRule({
      id: 'rule-1',
      name: 'Rule 1',
      slug: 'rule-1',
      datasources: [{ seedName: 'Seed One' }],
    });
    const ruleTwo = makeRule({
      id: 'rule-2',
      name: 'Rule 2',
      slug: 'rule-2',
      datasources: [{ seedName: 'Seed Two' }, { seedName: 'Seed One' }],
    });

    const listAllWorkflows = vi
      .spyOn(dao as any, 'listAllWorkflows')
      .mockResolvedValue([
        makeWorkflow('ds-1', 'Seed One'),
        makeWorkflow('ds-2', 'Seed Two'),
      ]);
    const listIntegrations = vi
      .spyOn(dao as any, 'listIntegrations')
      .mockResolvedValue(new Map());
    const getDatasourcePresence = vi
      .spyOn(dao as any, 'getDatasourcePresence')
      .mockResolvedValue(
        new Map([
          ['ds-1', { hasActivity: true, objectCount: 1 }],
          ['ds-2', { hasActivity: true, objectCount: 1 }],
        ]),
      );

    const enriched = await dao.enrichRules([ruleOne, ruleTwo]);

    expect(listAllWorkflows).toHaveBeenCalledTimes(1);
    expect(listIntegrations).toHaveBeenCalledTimes(1);
    expect(getDatasourcePresence).toHaveBeenCalledTimes(1);
    expect(enriched).toHaveLength(2);
    expect(enriched[0].datasources[0].status).toEqual(
      expect.objectContaining({ live: true, datasourceId: 'ds-1' }),
    );
    expect(enriched[1].datasources[0].status).toEqual(
      expect.objectContaining({ live: true, datasourceId: 'ds-2' }),
    );
    expect(enriched[1].datasources[1].status).toEqual(
      expect.objectContaining({ live: true, datasourceId: 'ds-1' }),
    );
  });
});
