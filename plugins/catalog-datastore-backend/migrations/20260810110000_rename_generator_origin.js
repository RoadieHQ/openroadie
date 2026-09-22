exports.up = async function up(knex) {
  await knex('datastore_relationship_rule')
    .where({ origin: 'llm-discovered' })
    .update({ origin: 'generated' });
  // Materialized edges copy the rule origin at apply time, so already-applied
  // edges must be renamed too or they keep the old value until re-applied.
  await knex('datastore_relation')
    .where({ origin: 'llm-discovered' })
    .update({ origin: 'generated' });
};

exports.down = async function down(knex) {
  await knex('datastore_relationship_rule')
    .where({ origin: 'generated' })
    .update({ origin: 'llm-discovered' });
  await knex('datastore_relation')
    .where({ origin: 'generated' })
    .update({ origin: 'llm-discovered' });
};
