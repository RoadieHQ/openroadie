import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ora from 'ora';
import { loadConfig } from '../config';
import { printResult, printFailure } from '../print';

/**
 * The readiness probe path served by the self-hosted backend on `backendUrl`.
 * The deploy artifacts (docker-compose + Dockerfile) front the running server on
 * port 7008 and expose a `/readiness` probe (mounted at root by
 * `@roadiehq/healthcheck-backend`, verified against the built image); `up` polls
 * it until it returns 200.
 */
export const READINESS_PATH = '/readiness';

/** Default poll budget: every 2s for ~120s before declaring a timeout. */
export const DEFAULT_POLL_INTERVAL_MS = 2000;
export const DEFAULT_TIMEOUT_MS = 120_000;

export interface CommandRun {
  args: string[];
  exitCode: number;
  stderr?: string;
}

export type ComposeRunner = (
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
) => Promise<CommandRun>;

export type ReadinessProbe = () => Promise<number>;

export interface UpResult {
  command: 'up';
  status: 'up' | 'failed';
  steps: Array<{ args: string[]; exitCode: number }>;
  server: { up: true; url: string } | null;
  waitedMs?: number;
  reason?: string;
}

export interface UpOptions {
  /** Shells out to `docker <args>`; injected so tests assert the sequence. */
  runCompose?: ComposeRunner;
  /** Probes the readiness endpoint; injected so tests drive pending→200. */
  probeReadiness?: ReadinessProbe;
  /** Injected so tests resolve immediately instead of waiting on real time. */
  sleep?: (ms: number) => Promise<void>;
  cwd?: string;
  hasComposeFile?: (cwd: string) => boolean;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /**
   * Image tag compose should pull for the `openroadie` service. Passed to
   * compose as `OPENROADIE_IMAGE_TAG` so the running server matches the CLI
   * that deployed it. Defaults to the CLI's own package version (`resolveImageTag`).
   */
  imageTag?: string;
  /** Path to the compose file shipped in the package; injected in tests. */
  packagedComposePath?: string;
}

/**
 * The CLI's own version, used as the default image tag so `openroadie up`
 * pulls the server image built from the same release. Falls back to `latest`
 * if the package.json can't be resolved (e.g. an unusual bundling layout).
 */
export function resolveImageTag(): string {
  try {
    const require = createRequire(__filename);
    const pkg = require('../../package.json') as { version?: string };
    return pkg.version ?? 'latest';
  } catch {
    return 'latest';
  }
}

/** The compose file shipped in the package root, next to `dist/`. */
/**
 * Find `docker-compose.yml` by walking up from `startDir`. The compose file
 * ships at the PACKAGE ROOT (package.json "files"), but this module is bundled
 * somewhere under dist/ whose nesting depth isn't guaranteed — so we search
 * upward rather than hard-code a relative hop. Returns undefined if not found.
 */
export function findComposeUpwards(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(dir, 'docker-compose.yml');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return undefined;
}

function resolvePackagedCompose(): string {
  // `openroadie up` from an empty directory must still find its shipped compose.
  return (
    findComposeUpwards(__dirname) ?? join(__dirname, '..', 'docker-compose.yml')
  );
}

const realSleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

/**
 * Real compose runner: shells `docker <args…>` in the process cwd, capturing the
 * exit code and stderr. A spawn-level error (docker not installed) resolves as a
 * non-zero exit with the message as stderr rather than throwing, so the caller
 * degrades with a clear message instead of an unhandled rejection.
 */
const realComposeRunner: ComposeRunner = (args, cwd, env) =>
  new Promise(resolve => {
    const childEnv = env ? { ...process.env, ...env } : process.env;
    execFile(
      'docker',
      args,
      { cwd, env: childEnv },
      (error, _stdout, stderr) => {
        if (error) {
          const exitCode = typeof error.code === 'number' ? error.code : 1;
          const message =
            stderr && stderr.trim() !== '' ? stderr : error.message;
          resolve({ args, exitCode, stderr: message });
          return;
        }
        resolve({ args, exitCode: 0, stderr });
      },
    );
  });

function defaultHasComposeFile(cwd: string): boolean {
  return (
    existsSync(join(cwd, 'docker-compose.yml')) ||
    existsSync(join(cwd, 'docker-compose.yaml')) ||
    existsSync(join(cwd, 'compose.yml')) ||
    existsSync(join(cwd, 'compose.yaml'))
  );
}

/** Real readiness probe: GET `${backendUrl}/readiness`, 0 on an unreachable server. */
function makeReadinessProbe(
  backendUrl: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): ReadinessProbe {
  const url = `${backendUrl.replace(/\/+$/, '')}${READINESS_PATH}`;
  return async () => {
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      return response.status;
    } catch {
      return 0;
    }
  };
}

/**
 * Bring the self-hosted server online:
 *  1. Run `docker compose up -d --build`, capturing its exit code. A non-zero
 *     exit fails fast.
 *  2. Poll the readiness endpoint every `pollIntervalMs` until it returns 200 or
 *     `timeoutMs` elapses. On 200 the server is up; on timeout it fails.
 *
 * Returns a structured result; never throws. `runUp` renders it.
 */
export async function bringServerUp(
  backendUrl: string,
  options: UpOptions = {},
  onProgress?: (message: string) => void,
): Promise<UpResult> {
  const runCompose = options.runCompose ?? realComposeRunner;
  const probeReadiness =
    options.probeReadiness ?? makeReadinessProbe(backendUrl);
  const sleep = options.sleep ?? realSleep;
  const cwd = options.cwd ?? process.cwd();
  const hasComposeFile = options.hasComposeFile ?? defaultHasComposeFile;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const imageTag = options.imageTag ?? resolveImageTag();

  const steps: UpResult['steps'] = [];

  // From a checkout, build from source. From an `npx` install there's no compose
  // in the cwd, so fall back to the one shipped in the CLI package, which pulls
  // the published image at the CLI's own version.
  const packagedCompose =
    options.packagedComposePath ?? resolvePackagedCompose();
  let composeArgs: string[];
  if (hasComposeFile(cwd)) {
    composeArgs = ['compose', 'up', '-d', '--build'];
  } else if (existsSync(packagedCompose)) {
    composeArgs = ['compose', '-f', packagedCompose, 'up', '-d'];
  } else {
    return {
      command: 'up',
      status: 'failed',
      steps,
      server: null,
      reason:
        'no Docker Compose file found in the working directory or shipped with the CLI',
    };
  }

  onProgress?.(`docker ${composeArgs.join(' ')}…`);
  const run = await runCompose(composeArgs, cwd, {
    OPENROADIE_IMAGE_TAG: imageTag,
  });
  steps.push({ args: run.args, exitCode: run.exitCode });
  if (run.exitCode !== 0) {
    const detail =
      run.stderr && run.stderr.trim() !== ''
        ? run.stderr.trim()
        : `exit code ${run.exitCode}`;
    return {
      command: 'up',
      status: 'failed',
      steps,
      server: null,
      reason: `docker ${composeArgs.join(' ')} failed (${detail})`,
    };
  }

  let waited = 0;
  for (;;) {
    onProgress?.(
      `waiting for ${backendUrl}${READINESS_PATH} (${waited / 1000}s)…`,
    );
    const status = await probeReadiness();
    if (status === 200) {
      return {
        command: 'up',
        status: 'up',
        steps,
        server: { up: true, url: backendUrl },
        waitedMs: waited,
      };
    }
    if (waited >= timeoutMs) {
      return {
        command: 'up',
        status: 'failed',
        steps,
        server: null,
        waitedMs: waited,
        reason: `server did not become ready within ${Math.round(
          timeoutMs / 1000,
        )}s (last readiness status ${status === 0 ? 'unreachable' : status})`,
      };
    }
    await sleep(pollIntervalMs);
    waited += pollIntervalMs;
  }
}

/**
 * `openroadie up` — deploy the self-hosted server via docker compose, then wait
 * (health-gated) until it answers readiness. Keeps the `JSON:`-line contract and
 * exits non-zero when compose or the readiness probe fails. No flags take
 * secrets: the credential boundary is unchanged.
 */
export async function runUp(options: UpOptions = {}): Promise<void> {
  const config = loadConfig();
  const spinner = ora('Bringing OpenRoadie online…').start();

  const result = await bringServerUp(config.backendUrl, options, message => {
    spinner.text = message;
  });

  if (result.status === 'up') {
    spinner.succeed(`OpenRoadie is up at ${config.backendUrl}`);
    const seconds =
      typeof result.waitedMs === 'number'
        ? Math.round(result.waitedMs / 1000)
        : 0;
    printResult(
      [
        `Server is up at ${config.backendUrl} (ready after ${seconds}s).`,
        'Next: openroadie status',
      ],
      result,
    );
    return;
  }

  spinner.fail('OpenRoadie did not come up');
  printFailure(
    [`Could not bring the server up: ${result.reason ?? 'unknown error'}`],
    result,
  );
}
