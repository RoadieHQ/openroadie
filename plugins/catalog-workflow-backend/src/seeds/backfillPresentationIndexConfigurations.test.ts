import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IndexConfiguration } from '@roadiehq/catalog-datastore-common';
import { backfillPresentationIndexConfigurations } from './backfillPresentationIndexConfigurations';

interface WorkflowRow {
  id: string;
  name: string;
  slug: string;
  workflow_type: string;
}

function makeKnex(workflows: WorkflowRow[]) {
  function workflowsHandle() {
    const handle: Record<string, unknown> = {
      where: (column: string, value: unknown) => {
        (handle as { _where?: Record<string, unknown> })._where = {
          ...((handle as { _where?: Record<string, unknown> })._where ?? {}),
          [column]: value,
        };
        return handle;
      },
      select: async () => {
        const where = (handle as { _where?: Record<string, unknown> })._where;
        return workflows.filter(row => {
          if (
            where?.workflow_type !== undefined &&
            row.workflow_type !== where.workflow_type
          ) {
            return false;
          }
          return true;
        });
      },
    };
    return handle;
  }

  const baseKnex = (table: string) => {
    if (table !== 'catalog_workflows') {
      throw new Error(`unexpected table: ${table}`);
    }
    return workflowsHandle();
  };

  return baseKnex as unknown as Parameters<
    typeof backfillPresentationIndexConfigurations
  >[0]['knex'];
}

function makeClient(
  existingByDatasource: Record<string, IndexConfiguration[]>,
) {
  return {
    listIndexConfigurations: vi.fn(async (datasourceId: string) => {
      return existingByDatasource[datasourceId] ?? [];
    }),
    createIndexConfiguration: vi.fn(async () => undefined),
  };
}

const logger = {
  child: () => logger,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Parameters<
  typeof backfillPresentationIndexConfigurations
>[0]['logger'];

describe('backfillPresentationIndexConfigurations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates missing presentation indexes for a seeded datasource matched by name', async () => {
    const client = makeClient({});

    const result = await backfillPresentationIndexConfigurations({
      knex: makeKnex([
        {
          id: 'workflow-1',
          name: 'Slack users',
          slug: 'slack-users',
          workflow_type: 'data-ingestion',
        },
      ]),
      client,
      logger,
    });

    expect(result).toEqual({ created: 2, skipped: 0, matched: 1 });
    expect(client.createIndexConfiguration).toHaveBeenCalledTimes(2);
    expect(client.createIndexConfiguration).toHaveBeenNthCalledWith(
      1,
      'workflow-1',
      {
        key: 'presentation.title',
        valueExpression: 'real_name ? real_name : profile.display_name',
        purpose: 'title',
      },
    );
    expect(client.createIndexConfiguration).toHaveBeenNthCalledWith(
      2,
      'workflow-1',
      {
        key: 'presentation.subtitle',
        valueExpression: 'profile.email ? profile.email : name',
        purpose: 'subtitle',
      },
    );
  });

  it('matches a renamed seeded datasource by preserved slug', async () => {
    const client = makeClient({});

    const result = await backfillPresentationIndexConfigurations({
      knex: makeKnex([
        {
          id: 'workflow-2',
          name: 'People in Slack',
          slug: 'slack-users',
          workflow_type: 'data-ingestion',
        },
      ]),
      client,
      logger,
    });

    expect(result).toEqual({ created: 2, skipped: 0, matched: 1 });
    expect(client.createIndexConfiguration).toHaveBeenNthCalledWith(
      1,
      'workflow-2',
      {
        key: 'presentation.title',
        valueExpression: 'real_name ? real_name : profile.display_name',
        purpose: 'title',
      },
    );
    expect(client.createIndexConfiguration).toHaveBeenNthCalledWith(
      2,
      'workflow-2',
      {
        key: 'presentation.subtitle',
        valueExpression: 'profile.email ? profile.email : name',
        purpose: 'subtitle',
      },
    );
  });

  it('skips index configs that already exist', async () => {
    const client = makeClient({
      'workflow-3': [
        {
          id: 'cfg-title',
          datasourceId: 'workflow-3',
          key: 'presentation.title',
          valueExpression: 'existingTitle',
          purpose: 'title',
        },
        {
          id: 'cfg-subtitle',
          datasourceId: 'workflow-3',
          key: 'presentation.subtitle',
          valueExpression: 'existingSubtitle',
          purpose: 'subtitle',
        },
      ],
    });

    const result = await backfillPresentationIndexConfigurations({
      knex: makeKnex([
        {
          id: 'workflow-3',
          name: 'Jira issues (per project)',
          slug: 'jira-issues-per-project',
          workflow_type: 'data-ingestion',
        },
      ]),
      client,
      logger,
    });

    expect(result).toEqual({ created: 0, skipped: 2, matched: 1 });
    expect(client.createIndexConfiguration).not.toHaveBeenCalled();
  });

  it('ignores workflows that are not mapped to reviewed selectors', async () => {
    const client = makeClient({});

    const result = await backfillPresentationIndexConfigurations({
      knex: makeKnex([
        {
          id: 'workflow-4',
          name: 'Custom datasource',
          slug: 'custom-datasource',
          workflow_type: 'data-ingestion',
        },
      ]),
      client,
      logger,
    });

    expect(result).toEqual({ created: 0, skipped: 0, matched: 0 });
    expect(client.createIndexConfiguration).not.toHaveBeenCalled();
  });
});
