import { describe, expect, it, vi } from 'vitest';
import { mockServices } from '@roadiehq/backend-test-utils';
import type { Knex } from 'knex';
import { DatastoreRepository } from './DatastoreRepository';
import type { ObjectDao } from './ObjectDao';
import type { SchemaDao } from './SchemaDao';
import type { IndexDao } from './IndexDao';
import type { RelationshipDao } from './RelationshipDao';
import type { RelationshipRuleDao } from './RelationshipRuleDao';
import type { DatasourceActivityDao } from './DatasourceActivityDao';

const buildRepository = (options: {
  query: ReturnType<typeof vi.fn>;
  activityGet?: ReturnType<typeof vi.fn>;
}) => {
  const objectDao = { query: options.query } as unknown as ObjectDao;
  const activityDao = options.activityGet
    ? ({ get: options.activityGet } as unknown as DatasourceActivityDao)
    : undefined;
  return new DatastoreRepository({
    knex: {} as Knex,
    logger: mockServices.logger.mock(),
    objectDao,
    schemaDao: {} as SchemaDao,
    indexDao: {} as IndexDao,
    relationshipDao: {} as RelationshipDao,
    relationshipRuleDao: {} as RelationshipRuleDao,
    activityDao,
  });
};

describe('DatastoreRepository.getDatasourceItems', () => {
  it('delegates to ObjectDao.query and returns the raw objects with the total', async () => {
    const query = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'row-1',
          datasourceId: 'ds-1',
          objectId: 'a',
          object: { id: 'a', name: 'Alpha' },
          relationshipCount: 2,
        },
      ],
      total: 42,
    });
    const repository = buildRepository({ query });

    const result = await repository.getDatasourceItems('ds-1', {
      limit: 10,
      offset: 20,
    });

    expect(query).toHaveBeenCalledWith('ds-1', { limit: 10, offset: 20 });
    expect(result).toEqual({
      items: [{ id: 'a', name: 'Alpha' }],
      total: 42,
    });
  });

  it('returns an empty result for a synced-but-empty datasource', async () => {
    const query = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const activityGet = vi.fn().mockResolvedValue({
      datasourceId: 'ds-1',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const repository = buildRepository({ query, activityGet });

    await expect(repository.getDatasourceItems('ds-1')).resolves.toEqual({
      items: [],
      total: 0,
    });
    expect(activityGet).toHaveBeenCalledWith('ds-1');
  });

  it('throws for a datasource the datastore has never seen', async () => {
    const query = vi.fn().mockResolvedValue({ items: [], total: 0 });
    const activityGet = vi.fn().mockResolvedValue(undefined);
    const repository = buildRepository({ query, activityGet });

    await expect(repository.getDatasourceItems('nope')).rejects.toThrow(
      'Data source not found: nope',
    );
  });
});
