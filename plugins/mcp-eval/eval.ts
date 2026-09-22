/**
 * MCP discoverability eval: ask a selected model the questions in
 * questions.json over the production Roadie MCP server, score the tool paths
 * it takes, and compare against baseline.json.
 *
 *   ROADIE_TOKEN=... yarn workspace @roadiehq/mcp-eval eval
 *   ... eval --baseline   # re-record baseline.json
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { BedrockRunner } from './bedrock-runner';

export const CLAUDE_CODE_VERSION = '2.1.224';
export const PROVIDER = process.env.MCP_EVAL_PROVIDER ?? 'claude-code';
export const MODEL =
  process.env.MCP_EVAL_MODEL ??
  (PROVIDER === 'bedrock'
    ? 'qwen.qwen3-235b-a22b-2507-v1:0'
    : 'claude-sonnet-5');
const MCP_URL =
  process.env.ROADIE_MCP_URL ?? 'https://app-api.roadie.so/api/mcp/v1';
const MAX_TURNS = 12;
// Trials per question — the agent isn't deterministic, so a single run's
// numbers are noisy. Score each question N times and take the median; bump
// this (e.g. EVAL_TRIALS=5) when recording a baseline to steady it.
const TRIALS = Math.max(1, Number(process.env.EVAL_TRIALS) || 1);
const QUESTION_LABELS = new Map([
  ['cross-source-identity', 'Cross-source identity'],
  ['pagerduty-schema', 'PagerDuty schema'],
  ['shortcut-relationship-traversal', 'Shortcut relationships'],
]);

// Read-only MCP tools — the only ones the agent is offered against prod.
const READ_ONLY = (name: string) =>
  name.startsWith('explore_') || name === 'integrations_list';

// A safety backstop for scoring: an MCP tool that changes state. The CLI
// allowlist already prevents these from running; if one ever appears, fail
// the question. Built-in agent tools (Read, Glob, …) are not MCP tools and
// are not a safety concern here — the dangerous ones are disallowed below.
const MUTATING = (name: string) =>
  name.startsWith('manage_') ||
  name.startsWith('actions_') ||
  name.startsWith('integrations_request');

// Built-in Claude Code tools the agent must not use — we're testing whether it
// can answer through the MCP catalog, not the local filesystem or the web.
const DISALLOWED_TOOLS =
  'Bash,Edit,Write,WebSearch,WebFetch,Read,Glob,Grep,NotebookEdit,Task,TodoWrite';

export interface Question {
  id: string;
  turns: string[];
  expectedToolPath: string[];
  expectedAnswerIncludes?: string[];
}

export interface Score {
  passed: boolean;
  answerCorrect: boolean;
  toolCalls: number;
  wrongTools: number;
  tokens: number;
  costUsd: number;
}

export interface QuestionDetail {
  turns: string[];
  calls: Array<{ name: string; input: unknown }>;
  steps: Step[];
  answer: string;
}

export type Step =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: unknown };

/** Parse Claude Code stream-json output into tool calls + token usage. */
export function parseStream(output: string): {
  tools: string[];
  calls: Array<{ name: string; input: unknown }>;
  steps: Step[];
  answer: string;
  tokens: number;
  costUsd?: number;
  sessionId?: string;
  completed: boolean;
} {
  const tools: string[] = [];
  const calls: Array<{ name: string; input: unknown }> = [];
  const steps: Step[] = [];
  let answer = '';
  let tokens = 0;
  let costUsd: number | undefined;
  let sessionId: string | undefined;
  let completed = false;
  for (const line of output.split('\n')) {
    let event: {
      type?: string;
      is_error?: boolean;
      session_id?: string;
      result?: unknown;
      message?: {
        content?: Array<{
          type?: string;
          name?: unknown;
          input?: unknown;
          text?: string;
          thinking?: string;
        }>;
      };
      usage?: Record<string, number | undefined>;
      total_cost_usd?: number;
    };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'assistant') {
      for (const block of event.message?.content ?? []) {
        // Preserve order: the agent's reasoning, then the tool it reached for,
        // then its next thought — this interleaving IS the discoverability
        // signal (how it decided which tool to try).
        if (block.type === 'thinking' && block.thinking) {
          steps.push({ type: 'thinking', text: block.thinking });
        }
        if (block.type === 'text' && block.text) {
          steps.push({ type: 'text', text: block.text });
          answer = block.text;
        }
        if (block.type === 'tool_use') {
          const name = String(block.name).replace(/^mcp__roadie__/, '');
          tools.push(name);
          calls.push({ name, input: block.input });
          steps.push({ type: 'tool', name, input: block.input });
        }
      }
    }
    if (event.type === 'result') {
      const u = event.usage ?? {};
      tokens +=
        (u.input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0) +
        (u.output_tokens ?? 0);
      if (typeof event.total_cost_usd === 'number') {
        costUsd = (costUsd ?? 0) + event.total_cost_usd;
      }
      sessionId = event.session_id ?? sessionId;
      completed = !event.is_error;
      if (typeof event.result === 'string' && event.result) {
        answer = event.result;
      }
    }
  }
  return {
    tools,
    calls,
    steps,
    answer,
    tokens,
    costUsd,
    sessionId,
    completed,
  };
}

export function combineTurnStatus(
  current: { completed: boolean; costComplete: boolean },
  turn: { completed: boolean; costUsd?: number },
): { completed: boolean; costComplete: boolean } {
  return {
    completed: current.completed && turn.completed,
    costComplete: current.costComplete && turn.costUsd !== undefined,
  };
}

/**
 * Pass = the agent reached the answer: it called every expected tool (order
 * doesn't matter — what matters is that it discovered the right tools), used
 * only read-only tools, and finished. Wrong tools (calls outside the expected
 * set) are reported as a number, not a pass/fail — that's the discoverability
 * signal, not a verdict.
 */
export function score(
  question: Question,
  toolsByTurn: string[][],
  answer: string,
  tokens: number,
  costUsd: number,
  completed: boolean,
): Score {
  const tools = toolsByTurn.flat();
  const expected = new Set(question.expectedToolPath);
  const called = new Set(tools);
  const foundAllExpected = question.expectedToolPath.every(t => called.has(t));
  const wrongTools = tools.filter(t => !expected.has(t)).length;
  const answerCorrect = missingAnswerValues(question, answer).length === 0;
  return {
    passed:
      foundAllExpected && answerCorrect && !tools.some(MUTATING) && completed,
    answerCorrect,
    toolCalls: tools.length,
    wrongTools,
    tokens,
    costUsd,
  };
}

export function missingAnswerValues(
  question: Question,
  answer: string,
): string[] {
  const normalizedAnswer = answer.toLocaleLowerCase();
  return (question.expectedAnswerIncludes ?? []).filter(
    value => !normalizedAnswer.includes(value.toLocaleLowerCase()),
  );
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted.at(mid) ?? 0;
  return Math.round(((sorted.at(mid - 1) ?? 0) + (sorted.at(mid) ?? 0)) / 2);
}

function medianCost(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted.at(mid) ?? 0;
  return ((sorted.at(mid - 1) ?? 0) + (sorted.at(mid) ?? 0)) / 2;
}

/** Collapse N trial scores of one question into a median (majority for pass). */
export function aggregate(trials: Score[]): Score {
  return {
    passed: trials.filter(t => t.passed).length > trials.length / 2,
    answerCorrect:
      trials.filter(t => t.answerCorrect).length > trials.length / 2,
    toolCalls: median(trials.map(t => t.toolCalls)),
    wrongTools: median(trials.map(t => t.wrongTools)),
    tokens: median(trials.map(t => t.tokens)),
    costUsd: medianCost(trials.map(t => t.costUsd)),
  };
}

interface Baseline {
  meta: {
    model: string;
    provider?: string;
    claudeCodeVersion?: string;
    trials: number;
    recordedAt: string;
    sourceRuns?: string[];
  };
  results: Record<string, Score>;
}

/**
 * Optional trend sink: one Langfuse trace per run with a score per question,
 * so discoverability can be tracked over time alongside the per-PR baseline
 * diff. No-op unless LANGFUSE_PUBLIC_KEY / _SECRET_KEY / _BASE_URL are set, so
 * local and secret-less CI runs are unaffected. Uses the ingestion API over
 * fetch — no SDK dependency.
 */
export async function sendToLangfuse(
  results: Record<string, Score>,
  details: Record<string, QuestionDetail>,
  timestamp: string,
): Promise<void> {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const baseUrl = process.env.LANGFUSE_BASE_URL;
  if (!publicKey || !secretKey || !baseUrl) return;

  const traceId = randomUUID();
  const entries = Object.entries(results);
  const passRate =
    entries.filter(([, r]) => r.passed).length / (entries.length || 1);
  const scores: Array<{ name: string; value: number }> = [
    { name: 'pass-rate', value: passRate },
    ...entries.flatMap(([id, r]) => [
      { name: `${id}:passed`, value: r.passed ? 1 : 0 },
      { name: `${id}:answer-correct`, value: r.answerCorrect ? 1 : 0 },
      { name: `${id}:wrong-tools`, value: r.wrongTools },
      { name: `${id}:tokens`, value: r.tokens },
      { name: `${id}:cost-usd`, value: r.costUsd },
    ]),
  ];
  // Nested child observations render as a readable timeline in the trace tree
  // (metadata alone hides the reasoning behind a JSON expander). Order them by
  // giving each a startTime a millisecond apart so Langfuse sorts them.
  const base = new Date(timestamp).getTime();
  const at = (offset: number) => new Date(base + offset).toISOString();

  const questionEvents = entries.flatMap(([id, r]) => {
    const detail = details[`${id}`];
    const spanId = randomUUID();
    const questionSpan = {
      id: randomUUID(),
      type: 'span-create',
      timestamp,
      body: {
        id: spanId,
        traceId,
        name: id,
        startTime: timestamp,
        // Close the span (post-hoc reconstruction has no real timing) so it
        // doesn't show as perpetually running in Langfuse.
        endTime: at((detail?.steps?.length ?? 0) + 1),
        input: detail?.turns,
        output: detail?.answer,
        metadata: {
          passed: r.passed,
          toolCalls: r.toolCalls,
          wrongTools: r.wrongTools,
          tokens: r.tokens,
          costUsd: r.costUsd,
        },
      },
    };
    // One child per step, nested under the question span: reasoning text as an
    // event, each tool call as a child span with its arguments.
    const stepEvents = (detail?.steps ?? []).map((step, i) =>
      step.type === 'tool'
        ? {
            id: randomUUID(),
            type: 'span-create',
            timestamp,
            body: {
              id: randomUUID(),
              traceId,
              parentObservationId: spanId,
              name: `🔧 ${step.name}`,
              startTime: at(i + 1),
              endTime: at(i + 1),
              input: step.input,
            },
          }
        : {
            id: randomUUID(),
            type: 'event-create',
            timestamp,
            body: {
              id: randomUUID(),
              traceId,
              parentObservationId: spanId,
              name: step.type === 'thinking' ? '💭 thinking' : '💬 reasoning',
              startTime: at(i + 1),
              output: step.text,
            },
          },
    );
    return [questionSpan, ...stepEvents];
  });

  const batch = [
    {
      id: randomUUID(),
      type: 'trace-create',
      timestamp,
      body: {
        id: traceId,
        timestamp,
        name: 'mcp-eval',
        input: entries.map(([id]) => id),
        output: { passRate, results },
        metadata: {
          provider: PROVIDER,
          model: MODEL,
          claudeCodeVersion:
            PROVIDER === 'claude-code' ? CLAUDE_CODE_VERSION : undefined,
        },
      },
    },
    ...questionEvents,
    // score-create bodies need their own `id` — without it the event is
    // silently rejected while the trace still lands.
    ...scores.map(s => ({
      id: randomUUID(),
      type: 'score-create',
      timestamp,
      body: { id: randomUUID(), traceId, name: s.name, value: s.value },
    })),
  ];

  // Best-effort: a Langfuse outage must never fail the eval or clobber the
  // summary, so swallow both non-2xx responses and network errors.
  try {
    // eslint-disable-next-line no-restricted-syntax -- external target: Langfuse telemetry ingestion, not an internal call.
    const response = await fetch(
      `${baseUrl.replace(/\/$/, '')}/api/public/ingestion`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}`,
        },
        body: JSON.stringify({ batch }),
      },
    );
    if (!response.ok) {
      console.error(`Langfuse ingestion failed: ${response.status}`);
    }
  } catch (error: unknown) {
    console.error(
      `Langfuse ingestion error: ${error instanceof Error ? error.message : error}`,
    );
  }
}

async function main() {
  const token = process.env.ROADIE_TOKEN;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!token) throw new Error('ROADIE_TOKEN is required.');
  if (PROVIDER === 'claude-code' && !apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for Claude Code evals.');
  }
  if (!['claude-code', 'bedrock'].includes(PROVIDER)) {
    throw new Error(`Unsupported MCP eval provider: ${PROVIDER}.`);
  }

  // Discover the server's read-only tools; the agent gets nothing else.
  const client = new Client({ name: 'mcp-eval', version: '0.0.1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const allowed = (await client.listTools()).tools
    .map(t => t.name)
    .filter(READ_ONLY)
    .map(name => `mcp__roadie__${name}`)
    .join(',');
  await client.close();

  const dir = mkdtempSync(join(tmpdir(), 'mcp-eval-'));
  const mcpConfig = join(dir, 'mcp.json');
  writeFileSync(
    mcpConfig,
    JSON.stringify({
      mcpServers: {
        roadie: {
          type: 'http',
          url: MCP_URL,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    }),
  );

  const questions: Question[] = JSON.parse(
    readFileSync(new URL('./questions.json', import.meta.url), 'utf8'),
  );
  const results: Record<string, Score> = {};
  const transcripts: Record<string, string> = {};
  const details: Record<string, QuestionDetail> = {};
  let runCostUsd = 0;
  let runCostComplete = true;
  try {
    for (const question of questions) {
      const trialScores: Score[] = [];
      let log: string[] = [];
      let lastCalls: Array<{ name: string; input: unknown }> = [];
      let lastSteps: Step[] = [];
      let lastAnswer = '';
      for (let trial = 0; trial < TRIALS; trial++) {
        const bedrockRunner =
          PROVIDER === 'bedrock'
            ? await BedrockRunner.create({
                mcpUrl: MCP_URL,
                roadieToken: token,
                modelId: MODEL,
                readOnly: READ_ONLY,
              })
            : undefined;
        const toolsByTurn: string[][] = [];
        const trialLog: string[] = [];
        const trialCalls: Array<{ name: string; input: unknown }> = [];
        const trialSteps: Step[] = [];
        const trialAnswers: string[] = [];
        let tokens = 0;
        let costUsd = 0;
        let completed = true;
        let sessionId: string | undefined;
        try {
          for (const [turn, prompt] of question.turns.entries()) {
            const parsed = bedrockRunner
              ? await bedrockRunner.run(prompt)
              : parseStream(
                  spawnSync(
                    'npx',
                    [
                      '--yes',
                      `@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}`,
                      '-p',
                      prompt,
                      '--output-format',
                      'stream-json',
                      '--verbose',
                      '--max-turns',
                      String(MAX_TURNS),
                      '--mcp-config',
                      mcpConfig,
                      '--strict-mcp-config',
                      '--tools',
                      '',
                      '--disallowedTools',
                      DISALLOWED_TOOLS,
                      '--allowedTools',
                      allowed,
                      '--permission-mode',
                      'dontAsk',
                      '--model',
                      MODEL,
                      ...(sessionId ? ['--resume', sessionId] : []),
                    ],
                    {
                      encoding: 'utf8',
                      env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
                      maxBuffer: 64 * 1024 * 1024,
                    },
                  ).stdout ?? '',
                );
            const turnStatus = combineTurnStatus(
              { completed, costComplete: runCostComplete },
              parsed,
            );
            completed = turnStatus.completed;
            runCostComplete = turnStatus.costComplete;
            toolsByTurn.push(parsed.tools);
            trialCalls.push(...parsed.calls);
            trialSteps.push({
              type: 'text',
              text: `Turn ${turn + 1}: ${prompt}`,
            });
            trialSteps.push(...parsed.steps);
            trialAnswers.push(parsed.answer || '(no answer)');
            tokens += parsed.tokens;
            costUsd += parsed.costUsd ?? 0;
            runCostUsd += parsed.costUsd ?? 0;
            if ('sessionId' in parsed) {
              sessionId = parsed.sessionId ?? sessionId;
            }
            trialLog.push(
              `**Turn ${turn + 1}:** ${prompt}\n`,
              ...parsed.calls.map(
                call =>
                  `- \`${call.name}\` \`${JSON.stringify(call.input) ?? '{}'}\``,
              ),
              `\n> ${parsed.answer.replaceAll('\n', '\n> ') || '(no answer)'}\n`,
            );
          }
        } finally {
          await bedrockRunner?.close();
        }
        const trialAnswer = trialAnswers.join('\n\n');
        trialScores.push(
          score(question, toolsByTurn, trialAnswer, tokens, costUsd, completed),
        );
        log = trialLog;
        lastCalls = trialCalls;
        lastSteps = trialSteps;
        lastAnswer = trialAnswer;
      }
      results[question.id] = aggregate(trialScores);
      transcripts[question.id] = log.join('\n');
      details[question.id] = {
        turns: question.turns,
        calls: lastCalls,
        steps: lastSteps,
        answer: lastAnswer,
      };
    }
  } finally {
    // the temp dir holds the ROADIE_TOKEN — remove it even on failure
    rmSync(dir, { recursive: true, force: true });
  }

  const baselinePath = new URL('./baseline.json', import.meta.url);
  let baseline: Baseline | undefined;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
  } catch {
    /* no baseline yet */
  }
  // Only compare against a baseline recorded with the same model — otherwise
  // the token deltas are cross-model noise.
  const comparable =
    baseline?.meta?.model === MODEL &&
    (baseline.meta.provider ?? 'claude-code') === PROVIDER
      ? baseline.results
      : undefined;
  const passed = Object.values(results).filter(r => r.passed).length;
  const displayModel =
    MODEL === 'qwen.qwen3-235b-a22b-2507-v1:0'
      ? 'Qwen3 235B'
      : MODEL === 'moonshotai.kimi-k2.5'
        ? 'Kimi K2.5'
        : MODEL;
  const baselineCostUsd = comparable
    ? Object.values(comparable).reduce(
        (total, result) => total + result.costUsd,
        0,
      )
    : undefined;
  const costComparison =
    runCostComplete && baselineCostUsd
      ? Math.round(((runCostUsd - baselineCostUsd) / baselineCostUsd) * 100)
      : undefined;
  const costDelta =
    costComparison === undefined
      ? ''
      : costComparison > 0
        ? ` · ${costComparison}% over baseline`
        : costComparison < 0
          ? ` · ${Math.abs(costComparison)}% under baseline`
          : ' · same as baseline';
  const lines: string[] = [
    `## MCP Eval: ${passed}/${questions.length} passed`,
    '',
    `${displayModel} on production · ${runCostComplete ? '' : 'at least '}**$${runCostUsd.toFixed(4)}**${costDelta}`,
    '',
  ];
  if (comparable) {
    lines.push('| Check | Tool use | vs baseline |', '| --- | --- | --- |');
  } else {
    lines.push('| Check | Tool use |', '| --- | --- |');
  }
  for (const [id, result] of Object.entries(results)) {
    const calls = `${result.toolCalls} call${result.toolCalls === 1 ? '' : 's'}`;
    const detours =
      result.wrongTools === 0
        ? 'no detours'
        : `${result.wrongTools} detour${result.wrongTools === 1 ? '' : 's'}`;
    const cells = [
      `${result.passed ? '✓' : '✗'} ${QUESTION_LABELS.get(id) ?? id.replaceAll('-', ' ')}`,
      `${calls} · ${detours}`,
    ];
    const baselineResult = comparable
      ? Object.entries(comparable).find(
          ([baselineId]) => baselineId === id,
        )?.[1]
      : undefined;
    if (baselineResult) {
      const callDelta = result.toolCalls - baselineResult.toolCalls;
      const detourDelta = result.wrongTools - baselineResult.wrongTools;
      const changes = [
        ...(callDelta === 0
          ? []
          : [
              `${callDelta > 0 ? '+' : ''}${callDelta} call${Math.abs(callDelta) === 1 ? '' : 's'}`,
            ]),
        ...(detourDelta === 0
          ? []
          : [
              `${detourDelta > 0 ? '+' : ''}${detourDelta} detour${Math.abs(detourDelta) === 1 ? '' : 's'}`,
            ]),
      ];
      cells.push(changes.length === 0 ? 'Same' : changes.join(' · '));
    } else if (comparable) {
      cells.push('No baseline');
    }
    lines.push(`| ${cells.join(' | ')} |`);
  }
  const summary = lines.join('\n');
  console.log(summary);

  writeFileSync(
    new URL('./results.json', import.meta.url),
    `${JSON.stringify({ runCostUsd, runCostComplete, results }, null, 2)}\n`,
  );
  writeFileSync(
    new URL('./transcripts.json', import.meta.url),
    `${JSON.stringify(details, null, 2)}\n`,
  );
  if (process.argv.includes('--baseline')) {
    const sourceRun =
      process.env.GITHUB_SERVER_URL &&
      process.env.GITHUB_REPOSITORY &&
      process.env.GITHUB_RUN_ID
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : undefined;
    const record: Baseline = {
      meta: {
        provider: PROVIDER,
        model: MODEL,
        claudeCodeVersion:
          PROVIDER === 'claude-code' ? CLAUDE_CODE_VERSION : undefined,
        trials: TRIALS,
        recordedAt: new Date().toISOString(),
        sourceRuns: sourceRun ? [sourceRun] : undefined,
      },
      results,
    };
    writeFileSync(baselinePath, `${JSON.stringify(record, null, 2)}\n`);
    console.log('\nBaseline recorded.');
  }

  // The Actions run page gets the same summary plus every question's full
  // transcript (tool calls with arguments + the agent's answer).
  if (process.env.GITHUB_STEP_SUMMARY) {
    const full = Object.entries(transcripts)
      .map(
        ([id, transcript]) =>
          `## ${id} — ${results[`${id}`].passed ? 'passed' : 'FAILED'}\n\n${transcript}`,
      )
      .join('\n\n');
    writeFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `${summary}\n\n---\n\n# Transcripts\n\n${full}\n`,
      { flag: 'a' },
    );
  }

  await sendToLangfuse(results, details, new Date().toISOString());
  process.exitCode = passed === questions.length ? 0 : 1;
}

const isCli =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
