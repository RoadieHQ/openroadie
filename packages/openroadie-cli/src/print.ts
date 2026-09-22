/**
 * Every command prints human-readable lines, then a single final
 * `JSON: {...}` line an agent parses. The JSON line is always last so a tool
 * can grab the last `JSON:`-prefixed line of stdout and read one structured
 * result regardless of how many human lines precede it.
 */
export function printResult(
  lines: string[],
  json: unknown,
  exitCode = 0,
): void {
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  process.stdout.write(`JSON: ${JSON.stringify(json)}\n`);
  process.exitCode = exitCode;
}

export function printFailure(lines: string[], json: unknown): void {
  printResult(lines, json, 1);
}
