exports.up = async function up(knex) {
  await knex.schema.createTable('workspace_members', table => {
    table
      .uuid('workspace_id')
      .notNullable()
      .references('id')
      .inTable('workspaces')
      .onDelete('CASCADE');
    table.text('user_id').notNullable();
    table.text('email').nullable();
    table.text('role').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.primary(['workspace_id', 'user_id']);
  });

  await knex.raw(`
    ALTER TABLE workspace_members ADD CONSTRAINT workspace_members_role_check
    CHECK (role IN ('owner', 'member'))
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX workspace_members_email_unique
    ON workspace_members (workspace_id, lower(email))
    WHERE email IS NOT NULL
  `);
  await knex.raw(`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    SELECT id, owner_user_id, 'owner'
    FROM workspaces
    WHERE type = 'personal' AND owner_user_id IS NOT NULL
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('workspace_members');
};
