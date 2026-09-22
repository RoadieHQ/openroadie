import { Knex } from 'knex';

export type RootMigration = {
  pluginId: string;
  run: (knex: Knex) => Promise<void>;
};

export const rootMigrations: RootMigration[] = [
  {
    pluginId: 'tech-insights',
    run: async (knex: Knex) => {
      const exists = await knex('knex_migrations')
        .where('name', '20251021115029_add_facts_id_timestamp_index.js')
        .first();

      if (!exists) {
        await knex('knex_migrations').insert({
          name: '20251021115029_add_facts_id_timestamp_index.js',
          batch: 1,
          migration_time: knex.fn.now(),
        });
      }
    },
  },
];
