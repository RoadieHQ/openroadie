const fs = require('fs');
const path = require('path');

function loadLogo(filename) {
  return fs.readFileSync(path.join(__dirname, 'logos', filename), 'utf-8');
}

exports.up = async function up(knex) {
  await knex('integrations')
    .where('slug', 'sentry')
    .update({ logo_svg: loadLogo('sentry.svg') });
};

exports.down = async function down(knex) {
  await knex('integrations')
    .where('slug', 'sentry')
    .update({ logo_svg: loadLogo('default.svg') });
};
