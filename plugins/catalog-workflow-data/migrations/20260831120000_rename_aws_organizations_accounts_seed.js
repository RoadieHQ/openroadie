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

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const OLD_NAMES = ['AWS Organizations accounts', 'AWS Organisation accounts'];
const OLD_SLUGS = OLD_NAMES.map(slugify);
const NEW_NAME = 'AWS accounts';
const NEW_SLUG = 'aws-accounts';
const NEW_DESCRIPTION =
  'List AWS accounts from Organizations and manually configured profiles.';

function isOrgAccountsSource(node) {
  if (node?.type !== 'source-integration') {
    return false;
  }
  const config = node.data?.config;
  return (
    config?.backendType === 'aws' &&
    config?.service === 'organizations' &&
    config?.operation === 'ListAccounts'
  );
}

function toConfiguredAccounts(node) {
  return {
    ...node,
    data: {
      ...node.data,
      label: 'List accounts',
      config: {
        integrationId: node.data.config.integrationId,
        backendType: 'aws',
        mode: 'configured-accounts',
      },
    },
  };
}

function rewriteNodes(nodes) {
  if (!Array.isArray(nodes)) {
    return { nodes, changed: false };
  }
  let changed = false;
  const next = nodes.map(node => {
    if (!isOrgAccountsSource(node)) {
      return node;
    }
    changed = true;
    return toConfiguredAccounts(node);
  });
  return { nodes: next, changed };
}

async function renameSeedIntroduction(trx, oldName) {
  const hasNewIntroduction = await trx('catalog_workflow_seed_introductions')
    .where({ seed_name: NEW_NAME })
    .first('seed_name');

  if (hasNewIntroduction) {
    await trx('catalog_workflow_seed_introductions')
      .where({ seed_name: oldName })
      .del();
    return;
  }

  await trx('catalog_workflow_seed_introductions')
    .where({ seed_name: oldName })
    .update({ seed_name: NEW_NAME });
}

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.transaction(async trx => {
    const candidates = await trx('catalog_workflows')
      .where(builder =>
        builder.whereIn('name', OLD_NAMES).orWhereIn('slug', OLD_SLUGS),
      )
      .orderBy('created_at', 'asc')
      .select('id', 'name', 'nodes', 'slug', 'version');

    const newNameTaken = Boolean(
      await trx('catalog_workflows').where({ name: NEW_NAME }).first('id'),
    );
    const newSlugHolder = await trx('catalog_workflows')
      .where({ slug: NEW_SLUG })
      .first('id');

    let assignedNewName = newNameTaken;

    for (const workflow of candidates) {
      const { nodes, changed } = rewriteNodes(workflow.nodes);
      const patch = {};

      if (changed) {
        patch.nodes = JSON.stringify(nodes);
        patch.version = workflow.version + 1;
      }

      if (OLD_NAMES.includes(workflow.name) && !assignedNewName) {
        patch.name = NEW_NAME;
        patch.description = NEW_DESCRIPTION;
        assignedNewName = true;
        if (!newSlugHolder || newSlugHolder.id === workflow.id) {
          patch.slug = NEW_SLUG;
        }
      }

      if (Object.keys(patch).length > 0) {
        patch.updated_at = trx.fn.now();
        await trx('catalog_workflows').where({ id: workflow.id }).update(patch);
      }
    }

    for (const oldName of OLD_NAMES) {
      await renameSeedIntroduction(trx, oldName);
    }
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  const oldName = OLD_NAMES[0];

  await knex.transaction(async trx => {
    const hasOldWorkflow = await trx('catalog_workflows')
      .where({ name: oldName })
      .first('id');

    if (!hasOldWorkflow) {
      await trx('catalog_workflows').where({ name: NEW_NAME }).update({
        name: oldName,
        updated_at: trx.fn.now(),
      });
    }

    const hasOldIntroduction = await trx('catalog_workflow_seed_introductions')
      .where({ seed_name: oldName })
      .first('seed_name');

    if (hasOldIntroduction) {
      await trx('catalog_workflow_seed_introductions')
        .where({ seed_name: NEW_NAME })
        .del();
    } else {
      await trx('catalog_workflow_seed_introductions')
        .where({ seed_name: NEW_NAME })
        .update({ seed_name: oldName });
    }
  });
};
