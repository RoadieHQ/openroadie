#!/usr/bin/env node
/*
 * Build the setup wizard as a standalone ESM bundle.
 *
 * The main CLI is bundled to CommonJS (`dist/index.cjs.js`), but the wizard's
 * UI stack — Ink, ink-spinner, ink-text-input — is ESM-only and uses top-level
 * `await`, which a CJS `require()` cannot load. So we emit the wizard (entry:
 * `src/render.tsx`, which pulls in the whole Ink/React tree plus the
 * backend bridge) as its own ESM file, `dist/setup-wizard.mjs`. `commands/
 * setup.ts` loads it at runtime via a native dynamic `import()`.
 *
 * Every bare-specifier dependency (ink, react, ora, commander, …) is left
 * external so it resolves from the installed `node_modules` at runtime; only the
 * package's own `src/` modules are bundled in. JSX uses the classic runtime to
 * match the wizard's `import React from 'react'` style.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');

await build({
  entryPoints: [resolve(pkgRoot, 'src/render.tsx')],
  outfile: resolve(pkgRoot, 'dist/setup-wizard.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  // Keep every third-party + node builtin external; bundle only our own source.
  packages: 'external',
  logLevel: 'info',
});
