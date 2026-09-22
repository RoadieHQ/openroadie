exports.up = async function up(knex) {
  const rows = await knex('catalog_workflows').select('id', 'nodes');

  for (const row of rows) {
    let nodes;
    try {
      nodes = typeof row.nodes === 'string' ? JSON.parse(row.nodes) : row.nodes;
    } catch {
      continue;
    }

    if (!Array.isArray(nodes)) {
      continue;
    }

    let changed = false;
    for (const node of nodes) {
      const config = node?.data?.config;
      if (
        node?.type === 'source-chained' &&
        config?.path ===
          '/_apis/git/repositories?project={{id}}&api-version=7.0' &&
        config?.pagination
      ) {
        delete config.pagination;
        changed = true;
      }
    }

    if (changed) {
      await knex('catalog_workflows')
        .where('id', row.id)
        .update({ nodes: JSON.stringify(nodes) });
    }
  }
};

exports.down = async function down() {};
