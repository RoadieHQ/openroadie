/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const [
    hasSuggestionKind,
    hasScore,
    hasConfidenceBand,
    hasEvidenceSummary,
    hasReviewReason,
  ] = await Promise.all([
    knex.schema.hasColumn('datastore_relationship_rule', 'suggestion_kind'),
    knex.schema.hasColumn('datastore_relationship_rule', 'score'),
    knex.schema.hasColumn('datastore_relationship_rule', 'confidence_band'),
    knex.schema.hasColumn('datastore_relationship_rule', 'evidence_summary'),
    knex.schema.hasColumn('datastore_relationship_rule', 'review_reason'),
  ]);

  await knex.schema.alterTable('datastore_relationship_rule', table => {
    if (!hasSuggestionKind) {
      table.text('suggestion_kind').nullable();
    }
    if (!hasScore) {
      table.float('score').nullable();
    }
    if (!hasConfidenceBand) {
      table.text('confidence_band').nullable();
    }
    if (!hasEvidenceSummary) {
      table.jsonb('evidence_summary').nullable();
    }
    if (!hasReviewReason) {
      table.text('review_reason').nullable();
    }
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const [
    hasSuggestionKind,
    hasScore,
    hasConfidenceBand,
    hasEvidenceSummary,
    hasReviewReason,
  ] = await Promise.all([
    knex.schema.hasColumn('datastore_relationship_rule', 'suggestion_kind'),
    knex.schema.hasColumn('datastore_relationship_rule', 'score'),
    knex.schema.hasColumn('datastore_relationship_rule', 'confidence_band'),
    knex.schema.hasColumn('datastore_relationship_rule', 'evidence_summary'),
    knex.schema.hasColumn('datastore_relationship_rule', 'review_reason'),
  ]);

  await knex.schema.alterTable('datastore_relationship_rule', table => {
    if (hasReviewReason) {
      table.dropColumn('review_reason');
    }
    if (hasEvidenceSummary) {
      table.dropColumn('evidence_summary');
    }
    if (hasConfidenceBand) {
      table.dropColumn('confidence_band');
    }
    if (hasScore) {
      table.dropColumn('score');
    }
    if (hasSuggestionKind) {
      table.dropColumn('suggestion_kind');
    }
  });
};
