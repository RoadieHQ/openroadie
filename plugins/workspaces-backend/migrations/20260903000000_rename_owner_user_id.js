/**
 * Renames `owner_user_ref` to `owner_user_id`. The create migration builds the
 * column under its current name, so this is a no-op on a fresh database and
 * only fires where an earlier revision of that migration has already run —
 * knex keys applied migrations by filename, so editing the original in place
 * left those databases on the old column.
 *
 * Postgres stores check constraints against column attnums, so
 * `workspaces_type_owner_check` follows the rename without being rebuilt.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('workspaces', 'owner_user_ref'))) {
    return;
  }

  await knex.raw(
    'ALTER TABLE workspaces RENAME COLUMN owner_user_ref TO owner_user_id',
  );
  await knex.raw(`
    COMMENT ON COLUMN workspaces.owner_user_id IS
      'User id of the owner; set for personal workspaces only'
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  if (!(await knex.schema.hasColumn('workspaces', 'owner_user_id'))) {
    return;
  }

  await knex.raw(
    'ALTER TABLE workspaces RENAME COLUMN owner_user_id TO owner_user_ref',
  );
};
