import { merge } from 'lodash';
import type { Knex } from 'knex';

export function mergeDatabaseConfig(
  config: Partial<Knex.Config>,
  ...overrides: Array<Partial<Knex.Config> | undefined>
): Knex.Config {
  return merge({}, config, ...overrides) as Knex.Config;
}
