import type { Knex } from 'knex';
import type {
  RootDatabaseService,
  RootLoggerService,
} from '@roadiehq/extensions-api';
import {
  coreServices,
  createServiceFactory,
  createServiceRef,
} from '@roadiehq/extensions-api';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import { applyDatabaseMigrations } from '../migrations';

const TABLE_NAME = 'secrets_metadata';

export interface SecretsMetadataService {
  getSecretInternalNames(workspaceId?: string): Promise<string[]>;
}

class DatabaseSecretsMetadataService implements SecretsMetadataService {
  constructor(private readonly knex: Knex) {}

  async getSecretInternalNames(
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<string[]> {
    const rows = await this.knex(TABLE_NAME)
      .where(builder => {
        builder.where('workspace_id', workspaceId);
        if (workspaceId !== DEFAULT_WORKSPACE_ID) {
          builder.orWhere(globalDefaults => {
            globalDefaults
              .where('workspace_id', DEFAULT_WORKSPACE_ID)
              .andWhere('is_custom', false);
          });
        }
      })
      .select('internal_name');
    return rows.map((row: { internal_name: string }) => row.internal_name);
  }
}

export const secretsMetadataServiceRef =
  createServiceRef<SecretsMetadataService>({
    id: 'roadie.secretsSettings.metadata',
    scope: 'root',
  });

export const secretsMetadataServiceFactory = createServiceFactory({
  service: secretsMetadataServiceRef,
  deps: {
    rootDatabase: coreServices.rootDatabase,
    logger: coreServices.rootLogger,
  },
  async factory({
    rootDatabase,
    logger,
  }: {
    rootDatabase: RootDatabaseService;
    logger: RootLoggerService;
  }) {
    const database = rootDatabase.forPlugin('secrets-settings');
    const knex = await database.getClient();

    if (!database.migrations?.skip) {
      await applyDatabaseMigrations(knex);
      logger.info('Secrets Settings database migrations completed');
    }

    return new DatabaseSecretsMetadataService(knex);
  },
});
