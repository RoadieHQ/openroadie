import { mockServices } from '@roadiehq/backend-test-utils';
import { DatastoreRepository } from './DatastoreRepository';

describe('DatastoreRepository workspace lifecycle', () => {
  it('drops queued auto-apply after its workspace is deleted', async () => {
    const workspaceId = '22222222-2222-4222-8222-222222222222';
    const workspaceExists = vi.fn().mockResolvedValue(false);
    const repository = new DatastoreRepository({
      knex: {} as never,
      logger: mockServices.logger.mock(),
      objectDao: {} as never,
      schemaDao: {} as never,
      indexDao: {} as never,
      relationshipDao: {} as never,
      relationshipRuleDao: {} as never,
      workspaceExists,
    });
    const apply = vi
      .spyOn(repository, 'applyRelationshipRulesForDatasources')
      .mockResolvedValue(undefined);

    await repository.applyPublishSideEffects(
      'datasource-1',
      { deleted: 0, updated: 1, inserted: 0 },
      workspaceId,
    );
    await repository.flushAutoApplyForTesting();

    expect(workspaceExists).toHaveBeenCalledWith(workspaceId);
    expect(apply).not.toHaveBeenCalled();
  });
});
