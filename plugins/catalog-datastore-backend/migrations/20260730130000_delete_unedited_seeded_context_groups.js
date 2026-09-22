/**
 * One-time cleanup: context groups become opt-in via the seed picker, so
 * delete seeder-created rules the user never edited. Any UI edit nulls
 * seed_version (ContextGroupDao.updateRule) and bumps updated_at, so edited
 * rules survive both clauses. Rows seeded before the seed_version column
 * existed (2026-07-24) are caught by the slug + never-updated clause.
 * context_group / context_group_member rows cascade via FK.
 */
const SEEDED_SLUGS = [
  'repositories',
  'people',
  'teams',
  'cloud-resources',
  'delivery-pipelines',
  'incident-response',
  'feature-management',
  'work-planning',
  'infrastructure-stacks',
  'runtime-environments',
  'vulnerability-management',
  'service-health-observability',
  'software-quality',
  'ai-platforms-usage',
  'communication-spaces',
  'identity-applications',
];

exports.up = async function up(knex) {
  await knex('context_group_rule')
    .where(builder =>
      builder.whereNotNull('seed_version').orWhere(inner =>
        inner
          .whereIn('slug', SEEDED_SLUGS)
          // Not strict equality: ContextGroupDao.createRule calls new Date()
          // separately for created_at and updated_at, so they can differ by
          // a few milliseconds on unedited rows.
          .andWhereRaw(`updated_at < created_at + interval '1 second'`),
      ),
    )
    .delete();
};

// Data deletion is irreversible; schema is unchanged.
exports.down = async function down() {};
