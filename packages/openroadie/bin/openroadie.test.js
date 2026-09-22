'use strict';

/*
 * Command-dispatch check for bin/openroadie.js — run with `node bin/openroadie.test.js`.
 * Guards the one non-trivial parse rule: a value-taking flag's value is not a command.
 */
const assert = require('node:assert');
const { findCommand } = require('./openroadie.js');

// bare invocation → no command token (caller defaults to serve)
assert.strictEqual(findCommand([]), undefined);
// --config's value must not be mistaken for the command
assert.strictEqual(findCommand(['--config', 'custom.yaml']), undefined);
assert.strictEqual(findCommand(['serve', '--config', 'custom.yaml']), 'serve');
assert.strictEqual(findCommand(['--config', 'custom.yaml', 'init']), 'init');
// plain commands and unknown tokens surface as-is
assert.strictEqual(findCommand(['init']), 'init');
assert.strictEqual(findCommand(['bogus']), 'bogus');
// boolean flags are skipped without eating the next token
assert.strictEqual(findCommand(['--verbose', 'init']), 'init');

console.log('openroadie bin dispatch: all assertions passed');
