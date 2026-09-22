import { createInterface } from 'node:readline';

/**
 * Read a secret from the TTY with no echo. The value never arrives via a flag,
 * an env var, or argv — only this hidden prompt — so the parser stays
 * `--token`-free and the secret leaves no trace in shell history or `ps`.
 *
 * The implementation mutes stdout while the user types: readline still collects
 * the keystrokes, but the muted output stream swallows the echo. On a
 * non-interactive stdin (a pipe) it reads the single line plainly, which keeps
 * the command scriptable in CI without leaking into a terminal.
 */
export function promptHidden(question: string): Promise<string> {
  const input = process.stdin;
  const output = process.stdout;
  const isTty = Boolean(input.isTTY);

  return new Promise((resolve, reject) => {
    // Non-TTY (piped/CI) stdin: read one plain line, no terminal mode and no
    // echo-muting. Forcing `terminal: true` on a pipe makes readline spin and
    // flood stdout (a one-line `secret set` ballooned to ~125 MB) — guard on
    // isTTY so a scripted `printf … | openroadie secret set` just works.
    if (!isTty) {
      const rl = createInterface({ input });
      output.write(question);
      rl.question('', answer => {
        rl.close();
        resolve(answer.trim());
      });
      rl.on('error', error =>
        reject(error instanceof Error ? error : new Error(String(error))),
      );
      return;
    }

    let muted = false;
    const realWrite = output.write.bind(output);
    // Replace stdout.write so the prompt prints once, then nothing echoes while
    // the user types the secret.
    const mutedWrite = ((chunk: unknown, ...rest: unknown[]): boolean => {
      if (muted) {
        return true;
      }
      // @ts-expect-error — forwarding the original variadic write signature
      return realWrite(chunk, ...rest);
    }) as typeof output.write;
    output.write = mutedWrite;

    const rl = createInterface({ input, output, terminal: true });
    rl.question(question, answer => {
      output.write = realWrite;
      // The newline the user pressed was muted; emit one so the next line is clean.
      realWrite('\n');
      rl.close();
      resolve(answer);
    });

    rl.on('error', error => {
      output.write = realWrite;
      rl.close();
      reject(error instanceof Error ? error : new Error(String(error)));
    });

    // Mute echo for everything after the question text is printed.
    muted = true;
  });
}
