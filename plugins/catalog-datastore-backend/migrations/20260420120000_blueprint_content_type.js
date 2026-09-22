/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // Change blueprint column from jsonb to text to support template strings
  await knex.schema.alterTable('blueprint', table => {
    table.text('blueprint').notNullable().alter();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  // Revert to jsonb (data may not be valid JSON after this migration)
  await knex.schema.alterTable('blueprint', table => {
    table.jsonb('blueprint').notNullable().alter();
  });
};
