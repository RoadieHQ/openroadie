exports.up = async function up(knex) {
  await knex.raw(
    'ALTER TABLE workspaces DROP CONSTRAINT workspaces_type_owner_check',
  );
  await knex.raw(`
    ALTER TABLE workspaces ADD CONSTRAINT workspaces_type_owner_check CHECK (
      (type IN ('organization', 'team') AND owner_user_id IS NULL) OR
      (type = 'personal' AND owner_user_id IS NOT NULL)
    )
  `);

  await knex.schema.createTable('teams', table => {
    table
      .uuid('id')
      .primary()
      .references('id')
      .inTable('workspaces')
      .onDelete('CASCADE');
  });

  await knex.schema.createTable('team_members', table => {
    table
      .uuid('team_id')
      .notNullable()
      .references('id')
      .inTable('teams')
      .onDelete('CASCADE');
    table.text('user_id').notNullable();
    table.text('email').nullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.primary(['team_id', 'user_id']);
  });

  await knex.raw(
    'CREATE UNIQUE INDEX team_members_email_unique ON team_members (team_id, lower(email))',
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('team_members');
  await knex('workspaces').where({ type: 'team' }).del();
  await knex.schema.dropTable('teams');
  await knex.raw(
    'ALTER TABLE workspaces DROP CONSTRAINT workspaces_type_owner_check',
  );
  await knex.raw(`
    ALTER TABLE workspaces ADD CONSTRAINT workspaces_type_owner_check CHECK (
      (type = 'organization' AND owner_user_id IS NULL) OR
      (type = 'personal' AND owner_user_id IS NOT NULL)
    )
  `);
};
