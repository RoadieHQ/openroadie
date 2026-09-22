/**
 * Re-indent the seeded default view template. The old template embedded
 * `{{ ... | json: 2 }}` at a 6-space column, but the `json` filter starts
 * continuation lines at column 0, so nested object data rendered flush-left.
 * liquid-safe's `json` filter now takes a second argument — the column the
 * value sits at — and the seed template passes it.
 *
 * Only rows still byte-identical to the old seed are rewritten: any template a
 * user has touched is theirs and is left alone.
 *
 * Kept in sync with DEFAULT_VIEW_TEMPLATE in
 * src/database/contextGroupViews.ts — migrations are frozen snapshots,
 * so the strings are duplicated rather than imported.
 */

const OLD_TEMPLATE = `{
{% for entry in members %}  {{ entry[0] | json }}: [
{% for member in entry[1] %}    {
      "objectId": {{ member.objectId | json }},
      "data": {{ member.data | json: 2 }},
      "related": {{ member | related | json: 2 }}
    }{% unless forloop.last %},{% endunless %}
{% endfor %}  ]{% unless forloop.last %},{% endunless %}
{% endfor %}}`;

const NEW_TEMPLATE = `{
{% for entry in members %}  {{ entry[0] | json }}: [
{% for member in entry[1] %}    {
      "objectId": {{ member.objectId | json }},
      "data": {{ member.data | json: 2, 6 }},
      "related": {{ member | related | json: 2, 6 }}
    }{% unless forloop.last %},{% endunless %}
{% endfor %}  ]{% unless forloop.last %},{% endunless %}
{% endfor %}}`;

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex('context_group_view')
    .where({ template: OLD_TEMPLATE })
    .update({ template: NEW_TEMPLATE });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex('context_group_view')
    .where({ template: NEW_TEMPLATE })
    .update({ template: OLD_TEMPLATE });
};
