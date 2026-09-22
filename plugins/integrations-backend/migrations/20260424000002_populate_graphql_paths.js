/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const DEFAULTS = [
  { slug: 'github', graphqlPath: '/graphql' },
  { slug: 'github-enterprise', graphqlPath: '/api/graphql' },
  { slug: 'gitlab', graphqlPath: '/api/graphql' },
  { slug: 'linear', graphqlPath: '/graphql' },
  { slug: 'shortcut', graphqlPath: '/api/v3/graphql' },
];

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  for (const { slug, graphqlPath } of DEFAULTS) {
    await knex('integrations')
      .where({ slug })
      .whereNull('graphql_path')
      .update({ graphql_path: graphqlPath });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const slugs = DEFAULTS.map(d => d.slug);
  await knex('integrations')
    .whereIn('slug', slugs)
    .update({ graphql_path: null });
};
