import { resolvePackagePath } from '@roadiehq/extensions-api';
import type { Knex } from 'knex';

export const applyMigrations = async (database: Knex) => {
  const migrationsDir = resolvePackagePath(
    '@roadiehq/actions-backend',
    'migrations',
  );
  await database.migrate.latest({
    directory: migrationsDir,
  });
};
