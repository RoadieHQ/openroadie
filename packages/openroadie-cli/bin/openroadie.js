#!/usr/bin/env node
/*
 * Binary shim for the `openroadie` install CLI.
 *
 * `roadie-cli package build` (the `cli` role) emits CJS to `dist/index.cjs.js`,
 * which exports a `main(argv)` entry. This shim loads that build and runs it.
 */

const { resolve } = require('node:path');

const distEntry = resolve(__dirname, '../dist/index.cjs.js');

let mod;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  mod = require(distEntry);
} catch (error) {
  process.stderr.write(
    'openroadie: build output not found at dist/index.cjs.js. ' +
      'Run `yarn workspace @roadiehq/openroadie-cli build` first.\n',
  );
  process.stderr.write(`${(error && error.message) || error}\n`);
  process.exit(1);
}

const main = mod.main || (mod.default && mod.default.main) || mod.default;

Promise.resolve(main(process.argv.slice(2))).catch(error => {
  process.stderr.write(`${(error && error.message) || error}\n`);
  process.exit(1);
});
