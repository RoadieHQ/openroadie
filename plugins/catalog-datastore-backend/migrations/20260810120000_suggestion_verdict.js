exports.up = async function up(knex) {
  await knex.schema.createTable('datastore_suggestion_verdict', table => {
    table.uuid('id').primary();
    table.uuid('rule_id').notNullable().index();
    table.string('action').notNullable();
    table.string('actor').notNullable();
    table.float('score').nullable();
    table.string('confidence_band').nullable();
    table.jsonb('evidence_summary').nullable();
    table.integer('rank_shown').nullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.index(['created_at']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('datastore_suggestion_verdict');
};
