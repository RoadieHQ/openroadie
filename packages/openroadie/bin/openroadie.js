#!/usr/bin/env node
'use strict';

/*
 * OpenRoadie standalone CLI.
 *
 *   openroadie init     scaffold app-config.yaml + .env in the current directory
 *   openroadie          serve the full portal (UI + /api) on one port
 *   openroadie --help
 *   openroadie --version
 *
 * `serve` boots the bundled backend (dist/index.js), pointing it at the shipped
 * frontend (web/) and migration files (migrations/), and at the user's config
 * in the current working directory.
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const pkgRoot = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);

// Flags that consume the next token as their value — skip that token when
// locating the command, so `openroadie --config custom.yaml` is `serve`, not
// an unknown command `custom.yaml`.
const VALUE_FLAGS = new Set(['--config']);
function findCommand(args) {
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) {
      i++;
      continue;
    }
    if (!args[i].startsWith('-')) return args[i];
  }
  return undefined;
}
const command = findCommand(argv) || 'serve';

function flag(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function readPkgVersion() {
  return JSON.parse(
    fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf-8'),
  ).version;
}

function printHelp() {
  process.stdout.write(
    [
      'OpenRoadie — standalone developer portal',
      '',
      'Usage:',
      '  openroadie [serve]        Start the portal (UI + API) on one port',
      '  openroadie init           Scaffold app-config.yaml and .env here',
      '  openroadie --version',
      '  openroadie --help',
      '',
      'Options for serve:',
      '  --config <path>           Path to app-config.yaml (default ./app-config.yaml)',
      '',
      'Environment:',
      '  DATABASE_URL              Postgres connection string (required)',
      '  OPENROADIE_AUTH_SECRET    Backend auth signing secret',
      '  APP_CONFIG_*              Override any config key, e.g. APP_CONFIG_backend_listen_port',
      '',
    ].join('\n'),
  );
}

// Minimal .env loader: KEY=VALUE lines, does not override already-set vars.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf-8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function runInit() {
  const cwd = process.cwd();
  const configDest = path.join(cwd, 'app-config.yaml');
  const envDest = path.join(cwd, '.env');

  if (fs.existsSync(configDest)) {
    console.log(`• app-config.yaml already exists — leaving it untouched`);
  } else {
    fs.copyFileSync(
      path.join(pkgRoot, 'templates', 'app-config.yaml'),
      configDest,
    );
    console.log(`✓ created app-config.yaml`);
  }

  if (fs.existsSync(envDest)) {
    console.log(`• .env already exists — leaving it untouched`);
  } else {
    const secret = crypto.randomBytes(32).toString('hex');
    const env = fs
      .readFileSync(path.join(pkgRoot, 'templates', 'env.example'), 'utf-8')
      .replace(
        'OPENROADIE_AUTH_SECRET=change-me',
        `OPENROADIE_AUTH_SECRET=${secret}`,
      );
    fs.writeFileSync(envDest, env);
    console.log(`✓ created .env (with a generated auth secret)`);
  }

  console.log('');
  console.log('Next steps:');
  console.log(
    '  1. Edit .env so DATABASE_URL points at your Postgres database',
  );
  console.log('  2. Run: openroadie');
}

function runServe() {
  const cwd = process.cwd();
  loadDotEnv(path.join(cwd, '.env'));

  const configPath = path.resolve(
    flag('--config') || path.join(cwd, 'app-config.yaml'),
  );
  if (!fs.existsSync(configPath)) {
    console.error(`No config found at ${configPath}`);
    console.error(
      'Run `openroadie init` to scaffold one, or pass --config <path>.',
    );
    process.exit(1);
  }

  // Point the bundled backend at the shipped frontend + migration files.
  process.env.OPENROADIE_WEB_DIR =
    process.env.OPENROADIE_WEB_DIR || path.join(pkgRoot, 'web');
  process.env.OPENROADIE_MIGRATIONS_DIR =
    process.env.OPENROADIE_MIGRATIONS_DIR || path.join(pkgRoot, 'migrations');
  // Config root for file discovery (avoids a package.json lookup in CWD).
  process.env.OPENROADIE_CONFIG_ROOT =
    process.env.OPENROADIE_CONFIG_ROOT || path.dirname(configPath);

  // The backend's config loader reads --config from process.argv.
  if (!process.argv.includes('--config')) {
    process.argv.push('--config', configPath);
  }

  require(path.join(pkgRoot, 'dist', 'index.js'));
}

function main() {
  if (
    process.argv.includes('--help') ||
    process.argv.includes('-h') ||
    command === 'help'
  ) {
    printHelp();
    process.exit(0);
  }
  if (
    process.argv.includes('--version') ||
    process.argv.includes('-v') ||
    command === 'version'
  ) {
    console.log(readPkgVersion());
    process.exit(0);
  }
  if (command === 'init') {
    runInit();
    process.exit(0);
  }
  if (command === 'serve') {
    runServe();
  } else {
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { findCommand };
