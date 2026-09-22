import { merge } from 'lodash';
import { Knex } from 'knex';

/**
 * Merges database objects together
 *
 * @public
 * @param config - The base config. The input is not modified
 * @param overrides - Any additional overrides
 */
export function mergeDatabaseConfig(
  config: Knex.Config,
  ...overrides: Array<Partial<Knex.Config> | undefined>
): Knex.Config {
  return merge({}, config, ...overrides);
}

/**
 * Provides a partial knex config with database name override.
 *
 * Default override for knex database drivers which accept ConnectionConfig
 * with `connection.database` as the database name field.
 *
 * @param name - database name to get config override for
 */
export function defaultNameOverride(name: string): Partial<Knex.Config> {
  return {
    connection: {
      database: name,
    },
  };
}

/**
 * Provides a partial knex config with schema name override.
 *
 * @param name - schema name to get config override for
 */
export function defaultSchemaOverride(name: string): Partial<Knex.Config> {
  return {
    searchPath: [name],
  };
}
