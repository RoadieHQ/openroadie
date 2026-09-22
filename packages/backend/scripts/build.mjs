#!/usr/bin/env node
import * as esbuild from 'esbuild';
import { copyFile, rm, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(__dirname, '..');
const distDir = resolve(packageDir, 'dist');

// Read backend's own non-workspace dependencies — these are always externalized
// because they're guaranteed to be in node_modules at runtime.
const pkg = JSON.parse(
  readFileSync(resolve(packageDir, 'package.json'), 'utf-8'),
);
const ownDeps = new Set(
  Object.keys(pkg.dependencies || {}).filter(d => !d.startsWith('@roadiehq/')),
);

// Cache: package name → whether it has native addons (binding.gyp)
const nativeCache = new Map();
function isNativePackage(name, resolveDir) {
  if (nativeCache.has(name)) return nativeCache.get(name);
  let native = false;
  try {
    const req = createRequire(resolve(resolveDir, '_'));
    const pkgJson = req.resolve(`${name}/package.json`);
    native = existsSync(resolve(dirname(pkgJson), 'binding.gyp'));
  } catch {
    // can't resolve → not native (will be caught by the unresolvable check)
  }
  nativeCache.set(name, native);
  return native;
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

// Build with esbuild.
// @roadiehq/* workspace packages are bundled into the output.
// Their transitive third-party deps (e.g. zod-to-json-schema from
// permission-common) are also bundled so they don't become dangling
// require() calls when not present in the container's node_modules.
// Backend's own direct deps and native/optional packages stay external.
await esbuild.build({
  entryPoints: [resolve(packageDir, 'src/index.ts')],
  outfile: resolve(distDir, 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  plugins: [
    {
      name: 'externalize-smart',
      setup(build) {
        build.onResolve({ filter: /^[^./]/ }, async args => {
          // Re-entrant probe (see build.resolve below) → let esbuild's default
          // resolver run so we can inspect whether the package is installed.
          if (args.pluginData?.externalizeProbe) return undefined;

          const name = args.path.startsWith('@')
            ? args.path.split('/').slice(0, 2).join('/')
            : args.path.split('/')[0];

          // Backend's direct deps → external (in node_modules at runtime)
          if (ownDeps.has(name)) return { path: args.path, external: true };

          // fsevents ships a prebuilt .node binary without a binding.gyp and is
          // a darwin-only optional dep of chokidar. It must never be bundled;
          // chokidar requires it lazily and tolerates its absence.
          if (name === 'fsevents') return { path: args.path, external: true };

          // @roadiehq/* workspaces → always bundle
          if (name.startsWith('@roadiehq/')) return undefined;

          // Native packages (binding.gyp) → external (can't bundle .node addons)
          if (isNativePackage(name, args.resolveDir)) {
            return { path: args.path, external: true };
          }

          // Decide external-vs-bundle by whether the package actually resolves.
          // We use esbuild's resolver (not Node's require.resolve) because the
          // latter throws for ESM-only packages that expose only an `import`
          // condition (e.g. xml-naming via fast-xml-parser) — those ARE
          // installed and must be bundled, not externalized into a broken
          // require(). Genuinely-missing optional deps (e.g. @azure/identity)
          // fail to resolve and stay external.
          const probe = await build.resolve(args.path, {
            kind: args.kind,
            resolveDir: args.resolveDir,
            pluginData: { externalizeProbe: true },
          });
          if (probe.errors.length > 0) {
            return { path: args.path, external: true };
          }

          // Installed & resolvable → bundle into the output
          return undefined;
        });
      },
    },
  ],
});

// Copy feature-flags.json into dist so it ships with the package
const repoRoot = resolve(packageDir, '..', '..');
await copyFile(
  resolve(repoRoot, 'feature-flags.json'),
  resolve(distDir, 'feature-flags.json'),
);

console.log('Build complete: dist/index.js');
