/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('datastore_relationship_layer', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.text('name').notNullable();
    table.text('description').nullable();
    table.text('color').nullable();
    table.integer('position').notNullable().defaultTo(0);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  const [defaultLayer] = await knex('datastore_relationship_layer')
    .insert({ name: 'Default', position: 0 })
    .returning('id');

  await knex.schema.createTable('datastore_relationship_rule_layer', table => {
    table
      .uuid('rule_id')
      .notNullable()
      .references('id')
      .inTable('datastore_relationship_rule')
      .onDelete('CASCADE');
    table
      .uuid('layer_id')
      .notNullable()
      .references('id')
      .inTable('datastore_relationship_layer')
      .onDelete('CASCADE');
    table.primary(['rule_id', 'layer_id']);
    table.index('layer_id', 'idx_rule_layer_layer_id');
  });

  const ruleIds = await knex('datastore_relationship_rule').select('id');
  if (ruleIds.length > 0) {
    await knex('datastore_relationship_rule_layer').insert(
      ruleIds.map(r => ({ rule_id: r.id, layer_id: defaultLayer.id })),
    );
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('datastore_relationship_rule_layer');
  await knex.schema.dropTableIfExists('datastore_relationship_layer');
};
