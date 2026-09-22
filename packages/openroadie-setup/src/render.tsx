import React from 'react';
import { render } from 'ink';
import { App } from './app';
import { runSelfCheck } from './persist';

/**
 * Launch the guided setup wizard in-process. This is the in-package replacement
 * for the old `wizard/index.tsx` entry that the mock repo shipped — same
 * behavior (selfcheck short-circuit, non-TTY guard, alt-screen enter/leave),
 * but rendered directly from `@roadiehq/openroadie-setup`.
 *
 * Returns `true` once the wizard has fully exited (or selfcheck/guard handled
 * the request), so `commands/setup.ts` can report a clean `done`. Sets
 * `process.exitCode` on the non-TTY guard path.
 */
export async function renderWizard(args: string[] = []): Promise<boolean> {
  if (args.includes('--selfcheck')) {
    await runSelfCheck();
    return true;
  }

  if (!process.stdin.isTTY) {
    // The wizard needs an interactive TTY (raw-mode keyboard input). Don't crash
    // with Ink's raw-mode error on a piped/CI stdin — explain the alternatives.
    console.log('The setup wizard needs an interactive terminal.');
    console.log(
      'Run `openroadie setup` directly in your terminal, or drive the steps with the CLI:',
    );
    console.log(
      '  openroadie integrations enable <ids> · secret set <id> · connect <id>',
    );
    process.exitCode = 1;
    return false;
  }

  process.stdout.write('\x1b[?1049h');
  const instance = render(<App />);
  try {
    await instance.waitUntilExit();
  } finally {
    process.stdout.write('\x1b[?1049l');
  }
  return true;
}
