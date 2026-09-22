const fs = require('fs');
const path = require('path');

/** Stable id for the workspace every deployment starts with. Referenced by
 *  name from application code and from the future `workspace_id` backfill, so
 *  it must never be regenerated. */
const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('workspaces', table => {
    table.comment(
      'Tenant workspaces: the boundary catalog data will belong to.',
    );

    table.uuid('id').primary().comment('Workspace identifier');

    table
      .text('name')
      .notNullable()
      .comment('Display name, shown in the picker');

    table
      .text('slug')
      .notNullable()
      .comment('URL-safe key. Immutable after create: slugs are addresses');

    table
      .text('type')
      .notNullable()
      .comment("'organization' (shared) or 'personal' (owner-only)");

    table
      .text('svg')
      .nullable()
      .comment('Uploaded square mark, rendered via a data: URL in an <img>');

    table
      .text('owner_user_id')
      .nullable()
      .comment('User id of the owner; set for personal workspaces only');

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });

  // Slugs are compared case-insensitively across both types, because a slug is
  // destined for a URL segment and a URL cannot disambiguate by owner.
  await knex.raw(
    'CREATE UNIQUE INDEX workspaces_slug_lower_unique ON workspaces (lower(slug))',
  );

  // The owner column carries the personal/organization distinction, so the
  // pairing is a structural constraint rather than something each write path
  // remembers to enforce.
  await knex.raw(`
    ALTER TABLE workspaces ADD CONSTRAINT workspaces_type_owner_check CHECK (
      (type = 'organization' AND owner_user_id IS NULL) OR
      (type = 'personal' AND owner_user_id IS NOT NULL)
    )
  `);

  const svg = fs.readFileSync(
    path.join(__dirname, 'logos', 'roadie-mark.svg'),
    'utf-8',
  );

  await knex('workspaces')
    .insert({
      id: DEFAULT_WORKSPACE_ID,
      name: 'Default',
      slug: 'default',
      type: 'organization',
      svg,
      owner_user_id: null,
    })
    .onConflict('id')
    .ignore();
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTable('workspaces');
};
