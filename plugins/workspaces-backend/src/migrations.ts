import { Knex } from 'knex';
import { resolvePackagePath } from '@roadiehq/extensions-api';

export async function applyMigrations(knex: Knex): Promise<void> {
  const migrationsDir = resolvePackagePath(
    '@roadiehq/workspaces-backend',
    'migrations',
  );
  await knex.migrate.latest({
    directory: migrationsDir,
    tableName: 'knex_migrations_workspaces',
  });
}
