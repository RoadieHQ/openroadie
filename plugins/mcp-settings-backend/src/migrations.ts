import { Knex } from 'knex';
import { resolvePackagePath } from '@roadiehq/extensions-api';

export async function applyDatabaseMigrations(knex: Knex): Promise<void> {
  const migrationsDir = resolvePackagePath(
    '@roadiehq/mcp-settings-backend',
    'migrations',
  );
  await knex.migrate.latest({
    directory: migrationsDir,
    tableName: 'knex_migrations_mcp_settings',
  });
}
