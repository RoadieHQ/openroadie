import { vi } from 'vitest';
import { buildProgram } from './program';

const mocks = vi.hoisted(() => ({
  runRelationshipsCreate: vi.fn(),
}));

vi.mock('./commands/relationships', async importOriginal => {
  const actual =
    await importOriginal<typeof import('./commands/relationships')>();
  return {
    ...actual,
    runRelationshipsCreate: mocks.runRelationshipsCreate,
  };
});

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

interface CliRun {
  stdout: string;
  json: Record<string, unknown>;
  exitCode: number | string | undefined;
  calls: Call[];
}

/**
 * Parse a real argv through `buildProgram` and drive the command end to end
 * against a stubbed fetch. Calling the exported `approveRules`/`updateRule`
 * helpers directly leaves the whole flag→field wiring, the command
 * registrations and the exit codes untested — a swapped
 * `--source-filter`/`--target-filter` mapping passed every one of those tests
 * while the CLI rewrote the wrong filter.
 */
async function runCli(
  argv: string[],
  handler: (url: string, method: string) => { status: number; body?: unknown },
): Promise<CliRun> {
  const calls: Call[] = [];
  const chunks: string[] = [];
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;

  const fetchStub = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method ?? 'GET';
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const { status, body } = handler(url, method);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body ?? {},
      text: async () => JSON.stringify(body ?? {}),
    } as unknown as Response;
  }) as unknown as typeof globalThis.fetch;

  const write = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      chunks.push(String(chunk));
      return true;
    });
  vi.stubGlobal('fetch', fetchStub);

  try {
    await buildProgram().parseAsync(argv, { from: 'user' });
  } finally {
    write.mockRestore();
    vi.unstubAllGlobals();
  }

  const exitCode = process.exitCode;
  process.exitCode = previousExitCode;

  const stdout = chunks.join('');
  const jsonLine = stdout.split('\n').find(line => line.startsWith('JSON: '));
  return {
    stdout,
    json: JSON.parse(jsonLine?.slice('JSON: '.length) ?? '{}') as Record<
      string,
      unknown
    >,
    exitCode,
    calls,
  };
}

/** Capture the usage error Commander prints on its way to `process.exit`. */
async function runCliExpectingUsageError(argv: string[]): Promise<string> {
  const errors: string[] = [];
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      errors.push(String(chunk));
      return true;
    });
  const exit = vi
    .spyOn(process, 'exit')
    .mockImplementation((() => undefined) as never);
  const stdout = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  try {
    await buildProgram().parseAsync(argv, { from: 'user' });
  } catch {
    // Commander reports the usage error and then calls `process.exit`; with
    // exit stubbed out it carries on and rethrows. The message it already
    // wrote to stderr is what we assert on.
  } finally {
    stderr.mockRestore();
    exit.mockRestore();
    stdout.mockRestore();
  }
  return errors.join('');
}

const RULE_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const OK = () => ({ status: 200, body: {} });

// Point the config loader at a path that cannot exist, so these tests use the
// default backend URL rather than whatever config the developer has on disk.
beforeAll(() => {
  process.env.OPENROADIE_CONFIG = '/nonexistent/openroadie-test-config.json';
});
afterAll(() => {
  delete process.env.OPENROADIE_CONFIG;
});

describe('buildProgram', () => {
  it('prints a structured failure for malformed --integration-config JSON', async () => {
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await buildProgram().parseAsync(
        [
          'node',
          'openroadie',
          'relationships',
          'create',
          '--name',
          'bad',
          '--source',
          'source-id',
          '--target',
          'target-id',
          '--source-field',
          '$.source',
          '--target-field',
          '$.target',
          '--relationship',
          'ownedBy',
          '--strategy',
          'integration-backed',
          '--integration-config',
          '{"integrationId":',
        ],
        { from: 'node' },
      );

      const output = write.mock.calls.map(call => String(call[0])).join('');
      const jsonLine = output
        .split('\n')
        .find(line => line.startsWith('JSON: '));

      expect(mocks.runRelationshipsCreate).not.toHaveBeenCalled();
      expect(jsonLine).toBeTruthy();
      expect(JSON.parse(jsonLine?.slice('JSON: '.length) ?? '{}')).toEqual({
        command: 'relationships create',
        status: 'failed',
        reason: expect.stringContaining('invalid --integration-config'),
      });
      expect(process.exitCode).toBe(1);
    } finally {
      write.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  it('rejects `bundle import --force --skip-existing` instead of picking one', async () => {
    // Opposite instructions for the same situation: silently taking either one
    // would overwrite what the user asked to keep, or keep what they asked to
    // overwrite.
    const errors: string[] = [];
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        errors.push(String(chunk));
        return true;
      });
    // Commander exits the process on a usage error, and `exitOverride` on an
    // already-built parent is not inherited by the subcommand — so stub the exit
    // and assert on the message it printed on the way out.
    const exit = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    try {
      await buildProgram().parseAsync(
        [
          'bundle',
          'import',
          '/tmp/does-not-matter',
          '--force',
          '--skip-existing',
        ],
        { from: 'user' },
      );
    } finally {
      stderr.mockRestore();
      exit.mockRestore();
    }

    expect(errors.join('')).toContain(
      "option '--skip-existing' cannot be used with option '--force'",
    );
  });
});

describe('relationships edit — flag → field wiring', () => {
  it('maps every edit flag onto the field it names', async () => {
    // The mapping is the whole command: a swapped source/target filter here
    // silently rewrites the wrong side of a live rule.
    const run = await runCli(
      [
        'relationships',
        'edit',
        RULE_ID,
        '--name',
        'new name',
        '--description',
        'what it captures',
        '--relationship',
        'ownedBy',
        '--reciprocal',
        'ownerOf',
        '--match-strategy',
        'contains',
        '--source-field',
        '$.srcField',
        '--target-field',
        '$.tgtField',
        '--source-filter',
        '$.srcFilter',
        '--target-filter',
        '$.tgtFilter',
      ],
      OK,
    );

    expect(run.calls).toHaveLength(1);
    expect(run.calls[0].method).toBe('PUT');
    expect(run.calls[0].url).toContain(`/relationship-rules/${RULE_ID}`);
    expect(run.calls[0].body).toEqual({
      name: 'new name',
      description: 'what it captures',
      relationshipType: 'ownedBy',
      reciprocalRelationshipType: 'ownerOf',
      matchStrategy: 'contains',
      sourceFieldExpression: '$.srcField',
      targetFieldExpression: '$.tgtField',
      sourceFilterExpression: '$.srcFilter',
      targetFilterExpression: '$.tgtFilter',
    });
    expect(run.exitCode).toBeFalsy();
  });

  it.each([
    ['--clear-description', 'description'],
    ['--clear-reciprocal', 'reciprocalRelationshipType'],
    ['--clear-source-filter', 'sourceFilterExpression'],
    ['--clear-target-filter', 'targetFilterExpression'],
  ])('%s sends null for %s', async (flag, field) => {
    const run = await runCli(['relationships', 'edit', RULE_ID, flag], OK);

    expect(run.calls[0].body).toEqual({ [`${field}`]: null });
    expect(run.json.changed).toEqual([field]);
  });

  it('refuses an empty --source-filter instead of writing an empty string', async () => {
    const run = await runCli(
      ['relationships', 'edit', RULE_ID, '--source-filter', ''],
      OK,
    );

    expect(run.calls).toHaveLength(0);
    expect(run.json.status).toBe('failed');
    expect(String(run.json.reason)).toContain('--clear-source-filter');
    expect(run.exitCode).toBe(1);
  });

  it('rejects setting and clearing the same field in one call', async () => {
    const errors = await runCliExpectingUsageError([
      'relationships',
      'edit',
      RULE_ID,
      '--source-filter',
      '$.x',
      '--clear-source-filter',
    ]);

    expect(errors).toContain(
      "option '--clear-source-filter' cannot be used with option '--source-filter",
    );
  });
});

describe('relationships list', () => {
  const RULE = {
    id: RULE_ID,
    state: 'suggested',
    strategy: 'field-matching',
    matchStrategy: 'exact',
    confidenceBand: 'high',
    score: 0.92,
    sourceDatasourceId: 'ds-a',
    targetDatasourceId: 'ds-b',
    sourceFieldExpression: '$.login',
    targetFieldExpression: '$.mention_name',
  };
  const listing = (url: string) =>
    url.includes('/workflows')
      ? { status: 200, body: { data: [] } }
      : { status: 200, body: { items: [RULE] } };

  it('prints the whole rule id, so it can be pasted into show/edit/reject', async () => {
    const run = await runCli(['relationships', 'list'], listing);

    expect(run.stdout).toContain(RULE_ID);
  });

  it('rejects an unknown --band instead of silently listing nothing', async () => {
    const errors = await runCliExpectingUsageError([
      'relationships',
      'list',
      '--band',
      'hgih',
    ]);

    expect(errors).toContain('Allowed choices are high, medium, low');
  });
});

describe('relationships show', () => {
  it('renders the rule and its evidence', async () => {
    const run = await runCli(['relationships', 'show', RULE_ID], () => ({
      status: 200,
      body: {
        id: RULE_ID,
        name: 'github → shortcut',
        state: 'suggested',
        relationshipType: 'sameAs',
        evidenceSummary: { explanation: '47 distinct values' },
      },
    }));

    expect(run.stdout).toContain('github → shortcut');
    expect(run.stdout).toContain('47 distinct values');
    expect(run.json.status).toBe('ok');
    expect(run.exitCode).toBeFalsy();
  });

  it('says "not found" only for a 404', async () => {
    const run = await runCli(['relationships', 'show', RULE_ID], () => ({
      status: 404,
      body: { error: 'Relationship rule not found' },
    }));

    expect(run.stdout).toContain(`No relationship rule with id ${RULE_ID}`);
    expect(run.json.reason).toBe('not found');
    expect(run.exitCode).toBe(1);
  });

  // The failure this fixes: an id copied out of `list` used to be truncated, the
  // backend 400s on it, and the CLI answered "that rule does not exist".
  it('surfaces a 400 as the backend rejection it is', async () => {
    const run = await runCli(['relationships', 'show', 'aaaaaaaa'], () => ({
      status: 400,
      body: { error: 'Invalid rule ID format' },
    }));

    expect(run.stdout).not.toContain('No relationship rule with id');
    expect(run.stdout).toContain('Invalid rule ID format');
    expect(run.stdout).toContain('HTTP status 400');
    expect(run.json.httpStatus).toBe(400);
    expect(run.exitCode).toBe(1);
  });
});

describe('relationships approve — exit codes', () => {
  const bulk = (body: unknown) => () => ({ status: 200, body });

  it('exits 0 when every requested rule is approved', async () => {
    const run = await runCli(
      ['relationships', 'approve', '--ids', 'a,b'],
      bulk({ approved: ['a', 'b'], dismissedAsInverse: [], failed: [] }),
    );

    expect(run.json.status).toBe('done');
    expect(run.exitCode).toBeFalsy();
  });

  // `approve --all && apply --all`: exiting 0 here let the chain run on and
  // report a clean install with a third of the joins never activated.
  it('exits non-zero when some requested rules failed', async () => {
    const run = await runCli(
      ['relationships', 'approve', '--ids', 'a,b'],
      bulk({
        approved: ['a'],
        dismissedAsInverse: [],
        failed: [
          {
            id: 'b',
            reason: "Rule is currently 'active', expected 'suggested'",
          },
        ],
      }),
    );

    expect(run.json.status).toBe('partial');
    expect(run.stdout).toContain('failed b:');
    expect(run.exitCode).toBe(1);
  });

  it('exits non-zero when a requested id was left suggested by its mirror', async () => {
    const run = await runCli(
      ['relationships', 'approve', '--ids', 'a,b'],
      bulk({
        approved: ['a'],
        dismissedAsInverse: [],
        failed: [
          {
            id: 'b',
            reason:
              'Left suggested: its opposite direction (a) was not approved',
          },
        ],
      }),
    );

    expect(run.exitCode).toBe(1);
  });

  // Nobody asked for the mirror, so nothing the caller requested failed — but
  // it is still live and needs a manual dismiss, so it must be reported.
  it('reports an unsuppressible mirror separately and still exits 0', async () => {
    const run = await runCli(
      ['relationships', 'approve', '--ids', 'a'],
      bulk({
        approved: ['a'],
        dismissedAsInverse: [],
        failed: [],
        inverseDismissFailed: [{ id: 'mirror-1', reason: 'db locked' }],
      }),
    );

    expect(run.json.status).toBe('done');
    expect(run.json.inverseDismissFailed).toEqual([
      { id: 'mirror-1', reason: 'db locked' },
    ]);
    expect(run.stdout).toContain('mirror mirror-1: db locked');
    expect(run.stdout).toContain('reject --ids mirror-1');
    expect(run.stdout).not.toContain('failed mirror-1');
    expect(run.exitCode).toBeFalsy();
  });

  // The worse outcome must not show less than `partial` does: when every id is
  // in `failed` and there is no top-level `reason`, the per-id causes are all
  // the caller has to act on.
  it('lists every per-id reason when the whole batch fails', async () => {
    const run = await runCli(
      ['relationships', 'approve', '--ids', 'a,b'],
      bulk({
        approved: [],
        dismissedAsInverse: [],
        failed: [
          {
            id: 'a',
            reason: "Rule is currently 'active', expected 'suggested'",
          },
          {
            id: 'b',
            reason: "Rule is currently 'inactive', expected 'suggested'",
          },
        ],
      }),
    );

    expect(run.json.status).toBe('failed');
    expect(run.stdout).toContain("failed a: Rule is currently 'active'");
    expect(run.stdout).toContain("failed b: Rule is currently 'inactive'");
    expect(run.exitCode).toBe(1);
  });

  it('exits 0 when --all finds nothing left to approve', async () => {
    const run = await runCli(['relationships', 'approve', '--all'], () => ({
      status: 200,
      body: { items: [] },
    }));

    expect(run.json.status).toBe('noop');
    expect(run.json.noopKind).toBe('nothing-to-do');
    expect(run.exitCode).toBeFalsy();
  });

  it('exits non-zero when no ids and no --all were given', async () => {
    const run = await runCli(['relationships', 'approve'], OK);

    expect(run.json.noopKind).toBe('no-ids-given');
    expect(run.exitCode).toBe(1);
  });
});

describe('relationships reject — exit codes', () => {
  it('exits non-zero when one dismiss fails', async () => {
    const run = await runCli(
      ['relationships', 'reject', '--ids', 'a,b'],
      url =>
        url.endsWith('/b/dismiss')
          ? { status: 500, body: { error: 'boom' } }
          : { status: 200, body: {} },
    );

    expect(run.json.status).toBe('partial');
    expect(run.exitCode).toBe(1);
  });

  it('exits 0 when every dismiss succeeds', async () => {
    const run = await runCli(['relationships', 'reject', '--ids', 'a,b'], OK);

    expect(run.json.status).toBe('done');
    expect(run.exitCode).toBeFalsy();
  });
});

describe('relationships reset', () => {
  it('is registered and posts each id to its reset route', async () => {
    const run = await runCli(['relationships', 'reset', 'a', 'b'], OK);

    expect(run.calls.map(c => c.url)).toEqual([
      expect.stringContaining('/relationship-rules/a/reset'),
      expect.stringContaining('/relationship-rules/b/reset'),
    ]);
    expect(run.json.status).toBe('done');
    expect(run.exitCode).toBeFalsy();
  });

  it('exits non-zero when one reset fails', async () => {
    const run = await runCli(['relationships', 'reset', '--ids', 'a,b'], url =>
      url.endsWith('/b/reset')
        ? { status: 409, body: { error: "expected 'inactive'" } }
        : { status: 200, body: {} },
    );

    expect(run.json.status).toBe('partial');
    expect(run.exitCode).toBe(1);
  });

  it('lists every per-id reason when every reset fails', async () => {
    const run = await runCli(
      ['relationships', 'reset', '--ids', 'a,b'],
      () => ({
        status: 409,
        body: { error: "expected 'inactive'" },
      }),
    );

    expect(run.json.status).toBe('failed');
    expect(run.stdout).toMatch(/failed a:.*expected 'inactive'/);
    expect(run.stdout).toMatch(/failed b:.*expected 'inactive'/);
    expect(run.exitCode).toBe(1);
  });

  it('exits non-zero when called with no ids at all', async () => {
    const run = await runCli(['relationships', 'reset'], OK);

    expect(run.calls).toHaveLength(0);
    expect(run.json.noopKind).toBe('no-ids-given');
    expect(run.exitCode).toBe(1);
  });
});

describe('relationships preview', () => {
  const items = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      sourceObjectId: `src-${i}`,
      relationshipType: 'resolvedTo',
      targetObjectIds: [`tgt-${i}`],
    }));
  const previewArgv = [
    'relationships',
    'preview',
    '--source',
    'ds-a',
    '--target',
    'ds-b',
    '--source-field',
    '$.name',
    '--target-field',
    '$.login',
    '--relationship',
    'resolvedTo',
  ];

  it('posts the unsaved rule to the preview route and prints the matches', async () => {
    const run = await runCli([...previewArgv, '--sample-limit', '5'], () => ({
      status: 200,
      body: { items: items(1), total: 1 },
    }));

    expect(run.calls[0].method).toBe('POST');
    expect(run.calls[0].url).toContain('/relationship-rules/preview');
    // Field-matching pages on `limit`, not `sampleLimit` (integration-backed
    // only), so --sample-limit must reach the backend as `limit`.
    expect(run.calls[0].url).toContain('limit=5');
    expect(run.calls[0].url).not.toContain('sampleLimit');
    expect(run.calls[0].body).toMatchObject({
      sourceDatasourceId: 'ds-a',
      targetDatasourceId: 'ds-b',
      sourceFieldExpression: '$.name',
      targetFieldExpression: '$.login',
      relationshipType: 'resolvedTo',
    });
    expect(run.stdout).toContain('src-0 —resolvedTo→ tgt-0');
    expect(run.stdout).not.toContain('showing');
  });

  // Without an explicit limit the backend pages field-matching at 5, too small
  // to judge a join; the CLI must request up to the display cap.
  it('sends a default limit of 25 for a field-matching preview', async () => {
    const run = await runCli(previewArgv, () => ({
      status: 200,
      body: { items: items(25), total: 25 },
    }));

    expect(run.calls[0].url).toContain('limit=25');
    expect(run.calls[0].url).not.toContain('sampleLimit');
  });

  it('says how many matches it left out of the printed list', async () => {
    const run = await runCli(previewArgv, () => ({
      status: 200,
      body: { items: items(40), total: 40 },
    }));

    expect(run.stdout).toContain('showing 25 of 40 match(es)');
    expect(run.stdout).toContain('the rest are in the JSON line');
  });

  // The backend pages field-matching, so a total of 100 arrives as a short page
  // with no `truncated` flag. The note must key off `total`, or the header says
  // "100 match(es)", a handful of lines follow, and nothing explains the gap —
  // a user could approve a join judged on a fraction of the rows.
  it('warns honestly when total exceeds the returned page', async () => {
    const run = await runCli(previewArgv, () => ({
      status: 200,
      body: { items: items(5), total: 100 },
    }));

    expect(run.stdout).toContain('showing 5 of 100 match(es)');
    expect(run.stdout).toContain('raise --sample-limit');
  });

  it('keeps the integration-backed path on sampleLimit', async () => {
    const run = await runCli(
      [
        ...previewArgv,
        '--strategy',
        'integration-backed',
        '--sample-limit',
        '5',
      ],
      () => ({
        status: 200,
        body: { items: items(1), total: 1 },
      }),
    );

    expect(run.calls[0].url).toContain('sampleLimit=5');
    expect(run.calls[0].url).not.toContain('limit=');
  });
});
