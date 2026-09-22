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

// Backfill graphql_path for the GitHub variants introduced by
// 20260425000001_split_github_integration. The earlier
// 20260424000002_populate_graphql_paths migration only knew the pre-split
// `github` slug, so the new `github-app` row never received a path; databases
// that ran the split before the populate migration also miss `github-token`.
const DEFAULTS = [
  { slug: 'github-token', graphqlPath: '/graphql' },
  { slug: 'github-app', graphqlPath: '/graphql' },
  { slug: 'github-enterprise-token', graphqlPath: '/api/graphql' },
  { slug: 'github-enterprise-app', graphqlPath: '/api/graphql' },
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
