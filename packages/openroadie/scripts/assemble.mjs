#!/usr/bin/env node
/*
 * Assemble the standalone, publishable `openroadie` npm package into ./out.
 *
 * Steps:
 *   1. Build the backend bundle (packages/backend/dist/index.js) and the
 *      frontend (packages/app/dist).
 *   2. Copy the backend bundle, frontend, feature-flags.json, bin, templates.
 *   3. Copy every plugin/package migrations dir into migrations/<dir>/ and emit
 *      a manifest.json mapping package name -> dir (consumed by the runtime
 *      packagePathMocks shim).
 *   4. Generate a clean package.json with runtime dependencies, bin, engines.
 *
 * The result in ./out is what gets `npm publish`ed (or installed for testing).
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  rmSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { builtinModules } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, '..'); // packages/openroadie
const repoRoot = resolve(pkgDir, '..', '..');
const out = resolve(pkgDir, 'out');
const requireFromRoot = createRequire(join(repoRoot, 'package.json'));

const log = msg => process.stdout.write(`[assemble] ${msg}\n`);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

if (process.env.OPENROADIE_SKIP_BUILD !== '1') {
  log('Building backend bundle (yarn workspace backend build)...');
  execFileSync('yarn', ['workspace', 'backend', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  log('Building frontend (yarn workspace app build)...');
  execFileSync('yarn', ['workspace', 'app', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, BACKEND_URL: '' },
  });
} else {
  log('OPENROADIE_SKIP_BUILD=1 — using existing build artifacts');
}

const backendDist = resolve(repoRoot, 'packages/backend/dist');
const appDist = resolve(repoRoot, 'packages/app/dist');
if (!existsSync(join(backendDist, 'index.js'))) {
  throw new Error(`Backend bundle missing at ${backendDist}/index.js`);
}
if (!existsSync(join(appDist, 'index.html'))) {
  throw new Error(`Frontend build missing at ${appDist}/index.html`);
}

log('Copying backend bundle -> out/dist');
cpSync(backendDist, join(out, 'dist'), { recursive: true });

log('Copying frontend -> out/web');
cpSync(appDist, join(out, 'web'), { recursive: true });

log('Copying bin + templates');
cpSync(join(pkgDir, 'bin'), join(out, 'bin'), {
  recursive: true,
  filter: src => !src.endsWith('.test.js'),
});
cpSync(join(pkgDir, 'templates'), join(out, 'templates'), { recursive: true });
if (existsSync(join(pkgDir, 'README.md'))) {
  cpSync(join(pkgDir, 'README.md'), join(out, 'README.md'));
}
// Ship the license text itself — the package.json field alone doesn't put it
// in the tarball, and the published package leaves the monorepo behind.
cpSync(join(repoRoot, 'LICENSE'), join(out, 'LICENSE'));

log('Collecting plugin migrations');
const migrationsOut = join(out, 'migrations');
mkdirSync(migrationsOut, { recursive: true });

const manifest = [];
const searchRoots = [
  resolve(repoRoot, 'plugins'),
  resolve(repoRoot, 'packages'),
];
for (const root of searchRoots) {
  if (!existsSync(root)) continue;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(root, entry.name);
    const migrationsDir = join(pkgPath, 'migrations');
    const pkgJsonPath = join(pkgPath, 'package.json');
    if (!existsSync(migrationsDir) || !existsSync(pkgJsonPath)) continue;

    const name = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')).name;
    if (!name || !name.startsWith('@roadiehq/')) continue;

    const dir = entry.name;
    cpSync(migrationsDir, join(migrationsOut, dir, 'migrations'), {
      recursive: true,
    });
    manifest.push({ name, dir });
    log(`  + ${name} -> migrations/${dir}/migrations`);
  }
}
writeFileSync(
  join(migrationsOut, 'manifest.json'),
  JSON.stringify(manifest, null, 2),
);
log(`Wrote manifest with ${manifest.length} packages`);

// Migration files ship verbatim (knex requires them from disk, they are NOT in
// the esbuild bundle), so any bare require() inside them needs a runtime
// dependency in the published package — e.g. integrations-backend's seed
// migrations require('uuid'). Scan the shipped files and collect those names.
const migrationRequires = new Set();
function scanForRequires(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanForRequires(full);
    } else if (entry.name.endsWith('.js')) {
      const src = readFileSync(full, 'utf-8');
      let m;
      const re = /require\(\s*["']([^"'.][^"']*)["']\s*\)/g;
      while ((m = re.exec(src)) !== null) {
        migrationRequires.add(m[1]);
      }
    }
  }
}
scanForRequires(migrationsOut);

log('Resolving runtime dependencies');

// Start from the backend's own non-@roadiehq deps (esbuild externalizes these),
// plus pg which knex loads dynamically (so it never appears as a literal
// require() in the bundle and must be added explicitly).
const backendPkg = JSON.parse(
  readFileSync(resolve(repoRoot, 'packages/backend/package.json'), 'utf-8'),
);
const required = new Set(
  Object.keys(backendPkg.dependencies || {}).filter(
    d => !d.startsWith('@roadiehq/'),
  ),
);
required.add('pg');
for (const name of migrationRequires) {
  if (!name.startsWith('node:')) required.add(name);
}

// fsevents is a darwin-only OPTIONAL dependency of chokidar, require()d inside
// a try/catch. Declaring it forces a native build on install (and fsevents
// 2.3.3 ships no binding.gyp, so that build fails). Omit it — chokidar falls
// back gracefully when it is absent, and the standalone does not watch files.
const OMIT = new Set(['fsevents']);

// Augment with any bare require() literals left in the bundle (native/optional
// modules esbuild externalized).
const bundleSource = readFileSync(join(backendDist, 'index.js'), 'utf-8');
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
]);
const requireRe = /require\(\s*["']([^"'.][^"']*)["']\s*\)/g;
let match;
while ((match = requireRe.exec(bundleSource)) !== null) {
  const spec = match[1];
  if (spec.startsWith('node:')) continue;
  const top = spec.startsWith('@')
    ? spec.split('/').slice(0, 2).join('/')
    : spec.split('/')[0];
  if (builtins.has(top) || top.startsWith('@roadiehq/')) continue;
  required.add(top);
}

const dependencies = {};
const uninstalled = [];
for (const name of [...required].sort()) {
  if (OMIT.has(name)) continue;
  try {
    const dep = JSON.parse(
      readFileSync(requireFromRoot.resolve(`${name}/package.json`), 'utf-8'),
    );
    dependencies[name] = `^${dep.version}`;
  } catch {
    // Not installed in the dev tree → an optional/lazy dependency only needed
    // by integrations the user opts into. Don't force-install it.
    uninstalled.push(name);
  }
}
if (uninstalled.length) {
  log(`Skipped optional/uninstalled deps: ${uninstalled.join(', ')}`);
}

// Release builds pass the tag-derived version (the same source the publish
// workflows stamp the CLI + image with); local assembles fall back to the
// monorepo root version.
const version =
  process.env.OPENROADIE_VERSION ||
  JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf-8')).version;

const generatedPkg = {
  // Scoped (@roadiehq/openroadie) while open-sourcing is paused, because npm
  // only allows SCOPED packages to be published private. At launch, set
  // OPENROADIE_PACKAGE_NAME=openroadie to ship the unscoped public name.
  name: process.env.OPENROADIE_PACKAGE_NAME || '@roadiehq/openroadie',
  version,
  description:
    'OpenRoadie developer portal — standalone distribution (UI + API in one process).',
  license: 'Apache-2.0',
  bin: { openroadie: 'bin/openroadie.js' },
  engines: { node: '>=22' },
  files: [
    'bin',
    'dist',
    'web',
    'migrations',
    'templates',
    'README.md',
    'LICENSE',
  ],
  dependencies,
};
writeFileSync(
  join(out, 'package.json'),
  `${JSON.stringify(generatedPkg, null, 2)}\n`,
);

log(`Done. Package assembled at ${out}`);
log(`Runtime dependencies: ${Object.keys(dependencies).join(', ')}`);
