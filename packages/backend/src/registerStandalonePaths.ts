/*
 * Standalone-distribution support: redirect plugin migration directory lookups.
 *
 * Plugins locate their knex migration directories at runtime via
 * `resolvePackagePath('@roadiehq/<plugin>', 'migrations')`, which does a
 * `require.resolve('@roadiehq/<plugin>/package.json')`. In the standalone
 * `openroadie` package the backend is a single esbuild bundle that inlines all
 * @roadiehq sources, so those packages are NOT present in node_modules and the
 * resolve would fail.
 *
 * `resolvePackagePath` consults a `packagePathMocks` map first. The assembly
 * script ships each plugin's migrations under
 *   <OPENROADIE_MIGRATIONS_DIR>/<dir>/migrations[/...]
 * and writes a manifest.json mapping each package name to its <dir>. Here we
 * read that manifest and register a resolver per package, so migration
 * discovery (and the __dirname-relative asset reads inside those migration
 * files, e.g. integrations-backend logos) resolves to the shipped files.
 *
 * No-op unless OPENROADIE_MIGRATIONS_DIR is set, so dev/Docker are unaffected.
 */
import { packagePathMocks } from '@roadiehq/extensions-api';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface MigrationManifestEntry {
  /** Package name, e.g. "@roadiehq/catalog-datastore-backend". */
  name: string;
  /** Sub-directory under the migrations dir holding the package's files. */
  dir: string;
}

export function registerStandaloneMigrationPaths(): void {
  const base = process.env.OPENROADIE_MIGRATIONS_DIR;
  if (!base) {
    return;
  }

  const manifestPath = join(base, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(
      `OPENROADIE_MIGRATIONS_DIR is set but no manifest.json was found at ${manifestPath}`,
    );
  }

  const entries = JSON.parse(
    readFileSync(manifestPath, 'utf-8'),
  ) as MigrationManifestEntry[];

  for (const { name, dir } of entries) {
    packagePathMocks.set(name, (paths: string[]) => join(base, dir, ...paths));
  }
}
