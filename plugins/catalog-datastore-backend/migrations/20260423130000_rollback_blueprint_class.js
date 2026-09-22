/**
 * Rollback migration for 20260420130000_blueprint_class.js
 * Restores concept_class column to blueprint table and drops blueprint_class table
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('blueprint', table => {
    table.dropUnique(['blueprint_class_id', 'version']);
    table.text('concept_class').nullable();
  });

  const blueprints = await knex('blueprint')
    .select('blueprint.id', 'blueprint_class.concept_class')
    .join(
      'blueprint_class',
      'blueprint.blueprint_class_id',
      'blueprint_class.id',
    );

  for (const bp of blueprints) {
    await knex('blueprint').where('id', bp.id).update({
      concept_class: bp.concept_class,
    });
  }

  await knex.schema.alterTable('blueprint', table => {
    table.text('concept_class').notNullable().alter();
    table.dropForeign('blueprint_class_id');
    table.dropColumn('blueprint_class_id');
    table.unique(['concept_class', 'version']);
  });

  await knex.schema.dropTableIfExists('blueprint_class');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.createTable('blueprint_class', table => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.text('concept_class').notNullable().unique();
    table.text('content_type').nullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('blueprint', table => {
    table.uuid('blueprint_class_id').nullable();
  });

  const existingBlueprints = await knex('blueprint')
    .select('concept_class')
    .groupBy('concept_class');

  for (const bp of existingBlueprints) {
    const [blueprintClass] = await knex('blueprint_class')
      .insert({
        concept_class: bp.concept_class,
      })
      .returning('*');

    await knex('blueprint')
      .where('concept_class', bp.concept_class)
      .update({ blueprint_class_id: blueprintClass.id });
  }

  await knex.schema.alterTable('blueprint', table => {
    table.uuid('blueprint_class_id').notNullable().alter();
    table
      .foreign('blueprint_class_id')
      .references('id')
      .inTable('blueprint_class')
      .onDelete('CASCADE');
  });

  await knex.schema.alterTable('blueprint', table => {
    table.dropUnique(['concept_class', 'version']);
    table.dropColumn('concept_class');
    table.unique(['blueprint_class_id', 'version']);
  });
};
