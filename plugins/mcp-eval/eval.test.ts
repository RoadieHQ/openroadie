import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aggregate,
  combineTurnStatus,
  parseStream,
  score,
  sendToLangfuse,
  type Question,
} from './eval';
import baseline from './baseline.json';

describe('committed baseline', () => {
  it('uses the median of four passing Qwen runs', () => {
    expect(baseline.meta).toMatchObject({
      provider: 'bedrock',
      model: 'qwen.qwen3-235b-a22b-2507-v1:0',
      trials: 4,
    });
    expect(baseline.meta.sourceRuns).toHaveLength(4);
    expect(Object.values(baseline.results)).toHaveLength(3);
    expect(Object.values(baseline.results).every(result => result.passed)).toBe(
      true,
    );
    expect(
      Object.values(baseline.results).reduce(
        (total, result) => total + result.costUsd,
        0,
      ),
    ).toBeCloseTo(0.038176, 6);
  });
});

const STREAM = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc' }),
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          name: 'mcp__roadie__explore_objects_search',
          input: { q: 'x' },
        },
      ],
    },
  }),
  JSON.stringify({
    type: 'result',
    is_error: false,
    session_id: 'abc',
    usage: {
      input_tokens: 100,
      cache_read_input_tokens: 900,
      output_tokens: 50,
    },
    total_cost_usd: 0.123456,
  }),
].join('\n');

describe('parseStream', () => {
  it('extracts tool names, tokens, and session from stream-json', () => {
    const parsed = parseStream(STREAM);
    expect(parsed.tools).toEqual(['explore_objects_search']);
    expect(parsed.tokens).toBe(1050);
    expect(parsed.costUsd).toBe(0.123456);
    expect(parsed.sessionId).toBe('abc');
    expect(parsed.completed).toBe(true);
  });
});

describe('combineTurnStatus', () => {
  it('tracks missing cost without failing a completed turn', () => {
    expect(
      combineTurnStatus(
        { completed: true, costComplete: true },
        { completed: true },
      ),
    ).toEqual({ completed: true, costComplete: false });
  });

  it('keeps an incomplete turn failed when cost is present', () => {
    expect(
      combineTurnStatus(
        { completed: true, costComplete: true },
        { completed: false, costUsd: 0.01 },
      ),
    ).toEqual({ completed: false, costComplete: true });
  });
});

describe('score', () => {
  const question: Question = {
    id: 'q',
    turns: ['find it', 'fetch it'],
    expectedToolPath: ['explore_objects_search', 'explore_object_get'],
  };

  it('passes when both expected tools were called', () => {
    const s = score(
      question,
      [['explore_objects_search'], ['explore_object_get']],
      'answer',
      10,
      0.01,
      true,
    );
    expect(s).toEqual({
      passed: true,
      answerCorrect: true,
      toolCalls: 2,
      wrongTools: 0,
      tokens: 10,
      costUsd: 0.01,
    });
  });

  it('passes regardless of order, counting detours as wrong tools', () => {
    const s = score(
      question,
      [
        ['explore_object_get', 'explore_datasources_list'],
        ['explore_objects_search'],
      ],
      'answer',
      10,
      0.01,
      true,
    );
    expect(s.passed).toBe(true);
    expect(s.wrongTools).toBe(1);
  });

  it('fails when an expected tool was never called', () => {
    const s = score(
      question,
      [['explore_objects_search'], ['explore_datasources_list']],
      'answer',
      10,
      0.01,
      true,
    );
    expect(s.passed).toBe(false);
  });

  it('fails when a mutating MCP tool was called', () => {
    const s = score(
      { id: 'q', turns: ['x'], expectedToolPath: ['explore_objects_search'] },
      [['explore_objects_search', 'manage_datasource_create']],
      'answer',
      10,
      0.01,
      true,
    );
    expect(s.passed).toBe(false);
  });

  it('passes when a harmless built-in tool appears (not an MCP concern)', () => {
    const s = score(
      { id: 'q', turns: ['x'], expectedToolPath: ['explore_schema_get'] },
      [['explore_datasources_list', 'explore_schema_get', 'Read']],
      'answer',
      10,
      0.01,
      true,
    );
    expect(s.passed).toBe(true);
    expect(s.wrongTools).toBe(2);
  });

  it('fails when the answer omits a required ground-truth value', () => {
    const s = score(
      {
        id: 'q',
        turns: ['x'],
        expectedToolPath: ['explore_objects_search'],
        expectedAnswerIncludes: ['PIHZSHO'],
      },
      [['explore_objects_search']],
      'Brian Fletcher',
      10,
      0.01,
      true,
    );
    expect(s.passed).toBe(false);
    expect(s.answerCorrect).toBe(false);
  });

  it('matches ground-truth values case-insensitively', () => {
    const s = score(
      {
        id: 'q',
        turns: ['x'],
        expectedToolPath: ['explore_objects_search'],
        expectedAnswerIncludes: ['PIHZSHO'],
      },
      [['explore_objects_search']],
      'Object id: pihzsho',
      10,
      0.01,
      true,
    );
    expect(s.passed).toBe(true);
    expect(s.answerCorrect).toBe(true);
  });

  it('does not accept the opposite truncation value', () => {
    const s = score(
      {
        id: 'q',
        turns: ['x'],
        expectedToolPath: ['explore_related_objects_get'],
        expectedAnswerIncludes: ['truncated: true'],
      },
      [['explore_related_objects_get']],
      'truncated: false',
      10,
      0.01,
      true,
    );
    expect(s.answerCorrect).toBe(false);
  });
});

describe('aggregate', () => {
  it('takes the median of numeric metrics and majority for pass', () => {
    const agg = aggregate([
      {
        passed: true,
        answerCorrect: true,
        toolCalls: 2,
        wrongTools: 0,
        tokens: 100,
        costUsd: 0.1,
      },
      {
        passed: true,
        answerCorrect: true,
        toolCalls: 4,
        wrongTools: 2,
        tokens: 300,
        costUsd: 0.3,
      },
      {
        passed: false,
        answerCorrect: false,
        toolCalls: 3,
        wrongTools: 1,
        tokens: 200,
        costUsd: 0.2,
      },
    ]);
    expect(agg).toEqual({
      passed: true,
      answerCorrect: true,
      toolCalls: 3,
      wrongTools: 1,
      tokens: 200,
      costUsd: 0.2,
    });
  });

  it('fails when the majority of trials fail', () => {
    const agg = aggregate([
      {
        passed: false,
        answerCorrect: false,
        toolCalls: 1,
        wrongTools: 0,
        tokens: 10,
        costUsd: 0.01,
      },
      {
        passed: false,
        answerCorrect: false,
        toolCalls: 1,
        wrongTools: 0,
        tokens: 10,
        costUsd: 0.01,
      },
      {
        passed: true,
        answerCorrect: true,
        toolCalls: 1,
        wrongTools: 0,
        tokens: 10,
        costUsd: 0.01,
      },
    ]);
    expect(agg.passed).toBe(false);
  });
});

describe('sendToLangfuse', () => {
  const results = {
    q: {
      passed: true,
      answerCorrect: true,
      toolCalls: 2,
      wrongTools: 0,
      tokens: 5,
      costUsd: 0.005,
    },
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is a no-op when Langfuse env is absent', async () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', '');
    vi.stubEnv('LANGFUSE_SECRET_KEY', '');
    vi.stubEnv('LANGFUSE_BASE_URL', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await sendToLangfuse(results, {}, '2026-01-01T00:00:00.000Z');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts a trace + scores to the ingestion API when configured', async () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk');
    vi.stubEnv('LANGFUSE_BASE_URL', 'https://lf.example.com/');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 207 }));

    await sendToLangfuse(results, {}, '2026-01-01T00:00:00.000Z');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://lf.example.com/api/public/ingestion');
    const body = JSON.parse((init as RequestInit).body as string);
    const names = body.batch.map(
      (e: { body: { name?: string } }) => e.body.name,
    );
    expect(names).toContain('pass-rate');
    expect(names).toContain('q:tokens');
  });
});
