const tableName = 'secrets_metadata';
const OLD_INTERNAL_NAME = 'GITHUB_APP_CLIENT_SECRET';
const NEW_INTERNAL_NAME = 'INTERNAL_GITHUB_APP_CLIENT_SECRET';

async function renameInternalName(knex, from, to) {
  const oldRow = await knex(tableName).where({ internal_name: from }).first();
  if (!oldRow) {
    return;
  }

  const newRow = await knex(tableName).where({ internal_name: to }).first();
  if (newRow) {
    await knex(tableName).where({ internal_name: from }).delete();
    return;
  }

  await knex(tableName).where({ internal_name: from }).update({
    internal_name: to,
  });
}

exports.up = async function up(knex) {
  await renameInternalName(knex, OLD_INTERNAL_NAME, NEW_INTERNAL_NAME);
};

exports.down = async function down(knex) {
  await renameInternalName(knex, NEW_INTERNAL_NAME, OLD_INTERNAL_NAME);
};
