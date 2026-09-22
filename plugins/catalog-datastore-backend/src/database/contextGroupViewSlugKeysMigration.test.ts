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

import { TestDatabases } from '@roadiehq/backend-test-utils';
import { resolvePackagePath } from '@roadiehq/extensions-api';
import { Knex } from 'knex';
import { randomUUID } from 'crypto';

const databases = TestDatabases.create();

const migrationsDir = resolvePackagePath(
  '@roadiehq/catalog-datastore-backend',
  'migrations',
);

const SLUG_KEYS_MIGRATION =
  '20260821120000_context_group_view_slug_document_keys.js';

/**
 * Builder-compiled fixtures, frozen. Kept in sync with the
 * 'slug-keys migration fixtures' cases in the app's compile-template.test.ts,
 * which prove both strings are byte-identical to the builder compiler's
 * output for their specs — so the migrated template still passes
 * parseViewTemplate's recompile check and stays builder-owned.
 */
const OLD_BUILDER_TEMPLATE = `{% comment %}roadie:view:v1 {"version":1,"format":"json","sources":[{"key":"github_members","label":"Github Members","fields":[{"path":"login"}],"related":[]}]}{% endcomment %}
{
  "github_members": [
{% for member in members.github_members %}    {
      "objectId": {{ member.objectId | json }},
      "login": {{ member.data.login | json }}
    }{% unless forloop.last %},{% endunless %}
{% endfor %}  ]
}`;

const MIGRATED_BUILDER_TEMPLATE = `{% comment %}roadie:view:v1 {"version":1,"format":"json","sources":[{"key":"github-members","label":"Github Members","fields":[{"path":"login"}],"related":[]}]}{% endcomment %}
{
  "github-members": [
{% for member in members['github-members'] %}    {
      "objectId": {{ member.objectId | json }},
      "login": {{ member.data.login | json }}
    }{% unless forloop.last %},{% endunless %}
{% endfor %}  ]
}`;

const OLD_HAND_WRITTEN_TEMPLATE = `## Members
{% for m in members.github_members %}- {{ m.data.login }}
{% endfor %}{% for s in members.shortcut %}- {{ s.data.email }}
{% endfor %}{% for o in members['okta_users'] %}- {{ o.data.id }}
{% endfor %}`;

const MIGRATED_HAND_WRITTEN_TEMPLATE = `## Members
{% for m in members['github-members'] %}- {{ m.data.login }}
{% endfor %}{% for s in members.shortcut %}- {{ s.data.email }}
{% endfor %}{% for o in members['okta-users'] %}- {{ o.data.id }}
{% endfor %}`;

// The generic default view: loops over entries, names no document key.
const DEFAULT_TEMPLATE = `{
{% for entry in members %}  {{ entry[0] | json }}: [
{% for member in entry[1] %}    {
      "objectId": {{ member.objectId | json }},
      "data": {{ member.data | json: 2, 6 }},
      "related": {{ member | related | json: 2, 6 }}
    }{% unless forloop.last %},{% endunless %}
{% endfor %}  ]{% unless forloop.last %},{% endunless %}
{% endfor %}}`;

describe('context_group_view slug document keys migration', () => {
  let testDb: Knex;

  beforeAll(async () => {
    testDb = await databases.init('POSTGRES_16');
  }, 120_000);

  afterAll(async () => {
    if (testDb) {
      await testDb.destroy();
    }
  });

  it('rewrites underscored document keys to slug keys', async () => {
    // Apply every migration before the slug-keys one, so fixture rows exist
    // when it runs. Stops when the slug-keys migration is the next one pending
    // rather than the only one — migrations added after it are none of this
    // test's business, and keying on "one left" made every later migration
    // break this test.
    for (;;) {
      const [, pending] = await testDb.migrate.list({
        directory: migrationsDir,
      });
      if (pending.length === 0) {
        throw new Error(`${SLUG_KEYS_MIGRATION} not found in ${migrationsDir}`);
      }
      if (pending[0].file === SLUG_KEYS_MIGRATION) {
        break;
      }
      await testDb.migrate.up({ directory: migrationsDir });
    }

    const ruleId = randomUUID();
    await testDb('context_group_rule').insert({
      id: ruleId,
      name: 'Team map',
      slug: 'team-map',
      datasources: JSON.stringify([]),
      merge_relation_types: JSON.stringify([]),
    });

    const views = {
      builder: OLD_BUILDER_TEMPLATE,
      hand_written: OLD_HAND_WRITTEN_TEMPLATE,
      generic_default: DEFAULT_TEMPLATE,
      already_slug_keyed: MIGRATED_BUILDER_TEMPLATE,
    };
    for (const [name, template] of Object.entries(views)) {
      await testDb('context_group_view').insert({
        id: randomUUID(),
        rule_id: ruleId,
        name,
        template,
        is_default: name === 'generic_default',
      });
    }

    await testDb.migrate.latest({ directory: migrationsDir });

    const rows = await testDb('context_group_view')
      .where({ rule_id: ruleId })
      .select('name', 'template');
    const byName = Object.fromEntries(rows.map(r => [r.name, r.template]));

    expect(byName.builder).toBe(MIGRATED_BUILDER_TEMPLATE);
    expect(byName.hand_written).toBe(MIGRATED_HAND_WRITTEN_TEMPLATE);
    expect(byName.generic_default).toBe(DEFAULT_TEMPLATE);
    expect(byName.already_slug_keyed).toBe(MIGRATED_BUILDER_TEMPLATE);
  });
});
