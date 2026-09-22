import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bringServerUp,
  findComposeUpwards,
  resolveImageTag,
  READINESS_PATH,
  type CommandRun,
} from './up';

const BACKEND_URL = 'http://localhost:7008';

// Resolve sleeps immediately so the readiness poll never waits on real time.
const noSleep = async (): Promise<void> => undefined;

/** A compose runner that records the argv tails and replies per a status map. */
function recordingCompose(
  calls: string[][],
  exitFor: (args: string[]) => { exitCode: number; stderr?: string },
  envs?: Array<NodeJS.ProcessEnv | undefined>,
): (
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
) => Promise<CommandRun> {
  return async (args: string[], _cwd: string, env?: NodeJS.ProcessEnv) => {
    calls.push(args);
    envs?.push(env);
    const { exitCode, stderr } = exitFor(args);
    return { args, exitCode, stderr };
  };
}

describe('bringServerUp — compose sequence', () => {
  it('runs `docker compose up -d --build` (no separate pull) pinning the image tag, then polls to a 200', async () => {
    const calls: string[][] = [];
    const envs: Array<NodeJS.ProcessEnv | undefined> = [];
    let probes = 0;
    const result = await bringServerUp(BACKEND_URL, {
      runCompose: recordingCompose(calls, () => ({ exitCode: 0 }), envs),
      hasComposeFile: () => true,
      imageTag: '9.9.9',
      probeReadiness: async () => {
        probes += 1;
        return probes < 2 ? 503 : 200;
      },
      sleep: noSleep,
      pollIntervalMs: 0,
      timeoutMs: 1000,
    });

    // Compose ran the single build-from-source step (no `compose pull`, which
    // hard-fails when no backend image is published).
    expect(calls).toEqual([['compose', 'up', '-d', '--build']]);

    // The compose invocation pinned the server image to the requested tag so
    // the running server matches the CLI that deployed it.
    expect(envs[0]).toEqual({ OPENROADIE_IMAGE_TAG: '9.9.9' });

    expect(probes).toBe(2);
    expect(result.status).toBe('up');
    expect(result.server).toEqual({ up: true, url: BACKEND_URL });
    expect(result.steps).toEqual([
      { args: ['compose', 'up', '-d', '--build'], exitCode: 0 },
    ]);
  });

  it('defaults the pinned image tag to the CLI version when none is given', async () => {
    const calls: string[][] = [];
    const envs: Array<NodeJS.ProcessEnv | undefined> = [];
    const result = await bringServerUp(BACKEND_URL, {
      runCompose: recordingCompose(calls, () => ({ exitCode: 0 }), envs),
      hasComposeFile: () => true,
      probeReadiness: async () => 200,
      sleep: noSleep,
      pollIntervalMs: 0,
      timeoutMs: 1000,
    });

    expect(result.status).toBe('up');
    // With no explicit imageTag, compose is pinned to the CLI's own version.
    expect(envs[0]).toEqual({ OPENROADIE_IMAGE_TAG: resolveImageTag() });
    expect(resolveImageTag()).toBe('0.1.0');
  });

  it('fails fast when `compose up -d --build` exits non-zero, never probing', async () => {
    const calls: string[][] = [];
    let probes = 0;
    const result = await bringServerUp(BACKEND_URL, {
      runCompose: recordingCompose(calls, () => ({
        exitCode: 1,
        stderr: 'failed to build: dockerfile not found',
      })),
      hasComposeFile: () => true,
      probeReadiness: async () => {
        probes += 1;
        return 200;
      },
      sleep: noSleep,
      pollIntervalMs: 0,
      timeoutMs: 1000,
    });

    expect(calls).toEqual([['compose', 'up', '-d', '--build']]);
    // The readiness endpoint was never probed after a compose failure.
    expect(probes).toBe(0);
    expect(result.status).toBe('failed');
    expect(result.server).toBeNull();
    expect(result.reason).toContain('docker compose up -d --build failed');
    expect(result.reason).toContain('dockerfile not found');
  });
});

describe('bringServerUp — readiness poll', () => {
  it('reports up once readiness returns 200 after several pending probes', async () => {
    let probes = 0;
    const result = await bringServerUp(BACKEND_URL, {
      runCompose: async (args: string[]) => ({ args, exitCode: 0 }),
      hasComposeFile: () => true,
      // Unreachable, then 503 (initializing), then 200.
      probeReadiness: async () => {
        probes += 1;
        if (probes === 1) return 0;
        if (probes === 2) return 503;
        return 200;
      },
      sleep: noSleep,
      pollIntervalMs: 2000,
      timeoutMs: 120_000,
    });

    expect(probes).toBe(3);
    expect(result.status).toBe('up');
    // Two intervals elapsed (after probe 1 and probe 2) before the 200 on probe 3.
    expect(result.waitedMs).toBe(4000);
  });

  it('times out with a clear message when readiness never reaches 200', async () => {
    let probes = 0;
    const result = await bringServerUp(BACKEND_URL, {
      runCompose: async (args: string[]) => ({ args, exitCode: 0 }),
      hasComposeFile: () => true,
      probeReadiness: async () => {
        probes += 1;
        return 503;
      },
      sleep: noSleep,
      pollIntervalMs: 2000,
      timeoutMs: 6000,
    });

    expect(result.status).toBe('failed');
    expect(result.server).toBeNull();
    // Budget is 6000ms with 2000ms intervals: probes at waited 0, 2000, 4000, 6000.
    expect(probes).toBe(4);
    expect(result.waitedMs).toBe(6000);
    expect(result.reason).toContain('did not become ready within 6s');
    expect(result.reason).toContain('last readiness status 503');
  });

  it('targets the /readiness path on the configured backend url', async () => {
    const seen: string[] = [];
    const fakeFetch = (async (input: string | URL | Request) => {
      seen.push(typeof input === 'string' ? input : input.toString());
      return { status: 200 } as unknown as Response;
    }) as unknown as typeof globalThis.fetch;

    // Drive the *real* probe factory by leaving probeReadiness unset and
    // injecting fetch via a hand-rolled probe that mirrors makeReadinessProbe.
    const result = await bringServerUp(BACKEND_URL, {
      runCompose: async (args: string[]) => ({ args, exitCode: 0 }),
      hasComposeFile: () => true,
      probeReadiness: async () => {
        const res = await fakeFetch(`${BACKEND_URL}${READINESS_PATH}`, {
          method: 'GET',
        });
        return res.status;
      },
      sleep: noSleep,
      pollIntervalMs: 0,
      timeoutMs: 1000,
    });

    expect(result.status).toBe('up');
    expect(seen[0]).toBe(`http://localhost:7008${READINESS_PATH}`);
    expect(seen[0]).toBe('http://localhost:7008/readiness');
  });

  it('fails before docker when there is no compose file anywhere', async () => {
    const calls: string[][] = [];
    const result = await bringServerUp(BACKEND_URL, {
      runCompose: recordingCompose(calls, () => ({ exitCode: 0 })),
      hasComposeFile: () => false,
      packagedComposePath: '/does/not/exist/docker-compose.yml',
      sleep: noSleep,
      pollIntervalMs: 0,
      timeoutMs: 1000,
    });

    expect(calls).toEqual([]);
    expect(result.status).toBe('failed');
    expect(result.steps).toEqual([]);
    expect(result.server).toBeNull();
    expect(result.reason).toContain('shipped with the CLI');
  });

  it('falls back to the packaged compose (pull, no build) when the cwd has none', async () => {
    const calls: string[][] = [];
    const packaged = `${__dirname}/../../docker-compose.yml`;
    const result = await bringServerUp(BACKEND_URL, {
      runCompose: recordingCompose(calls, () => ({ exitCode: 0 })),
      hasComposeFile: () => false,
      packagedComposePath: packaged,
      probeReadiness: async () => 200,
      sleep: noSleep,
      pollIntervalMs: 0,
      timeoutMs: 1000,
    });

    expect(calls).toEqual([['compose', '-f', packaged, 'up', '-d']]);
    expect(result.status).toBe('up');
  });
});

describe('findComposeUpwards', () => {
  it('finds docker-compose.yml at an ancestor of the start dir (bundle nested under dist/)', () => {
    const root = mkdtempSync(join(tmpdir(), 'or-compose-'));
    writeFileSync(join(root, 'docker-compose.yml'), 'services: {}\n');
    const nested = join(root, 'dist', 'commands');
    mkdirSync(nested, { recursive: true });
    expect(findComposeUpwards(nested)).toBe(join(root, 'docker-compose.yml'));
    rmSync(root, { recursive: true, force: true });
  });

  it('returns undefined when no compose file exists above the start dir', () => {
    const root = mkdtempSync(join(tmpdir(), 'or-nocompose-'));
    const nested = join(root, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(findComposeUpwards(nested)).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  });
});
