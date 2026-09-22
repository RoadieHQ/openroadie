import ora from 'ora';
import { loadConfig } from '../config';
import { printResult, printFailure } from '../print';
import { mcpClientConfig } from '../mcp-config';
import {
  MCP_TOOLS,
  type ExploreSession,
  type ToolCallResult,
  openExplore,
} from '../mcp-client';

/** One catalog object as the search tool returns it (subset the CLI reads). */
interface SearchItem {
  datasourceId?: string;
  objectId?: string;
  object?: unknown;
}

interface SearchPayload {
  items?: SearchItem[];
  total?: number;
}

export interface QueryResult {
  command: 'query';
  status: 'answered' | 'failed';
  question: string;
  matchCount: number;
  top?: { datasourceId?: string; objectId?: string };
  relatedCount: number;
  answer: string;
  reason?: string;
}

function parseSearch(
  session: Pick<ToolCallResult, 'text' | 'structured'>,
): SearchPayload | undefined {
  if (session.structured && typeof session.structured === 'object') {
    return session.structured as SearchPayload;
  }
  if (session.text) {
    try {
      return JSON.parse(session.text) as SearchPayload;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Run a catalog query over the explore MCP session: `explore_objects_search`
 * for the question, then `explore_related_objects_get` on the top hit,
 * and relay the combined answer. The session is injected so the unit test drives
 * it with a fake — asserting the tool names + arguments and the relayed result —
 * without opening a real connection.
 */
export async function runQueryWithSession(
  session: ExploreSession,
  question: string,
): Promise<QueryResult> {
  const search = await session.callTool(MCP_TOOLS.search, { q: question });
  if (search.isError) {
    return {
      command: 'query',
      status: 'failed',
      question,
      matchCount: 0,
      relatedCount: 0,
      answer: search.text,
      reason: 'search tool returned an error',
    };
  }

  const payload = parseSearch(search);
  const items = payload?.items ?? [];
  const matchCount =
    typeof payload?.total === 'number' ? payload.total : items.length;

  if (items.length === 0) {
    return {
      command: 'query',
      status: 'answered',
      question,
      matchCount,
      relatedCount: 0,
      answer: search.text || 'No matching catalog objects found.',
    };
  }

  const top = items[0];
  let relatedCount = 0;
  let relatedText = '';

  if (top.datasourceId && top.objectId) {
    const related = await session.callTool(MCP_TOOLS.related, {
      datasourceId: top.datasourceId,
      objectId: top.objectId,
    });
    if (!related.isError) {
      relatedText = related.text;
      const structured = related.structured as
        | { relatedObjects?: unknown[]; total?: number }
        | undefined;
      relatedCount =
        typeof structured?.total === 'number'
          ? structured.total
          : (structured?.relatedObjects?.length ?? 0);
    }
  }

  const answer = [search.text, relatedText].filter(Boolean).join('\n');
  return {
    command: 'query',
    status: 'answered',
    question,
    matchCount,
    top: { datasourceId: top.datasourceId, objectId: top.objectId },
    relatedCount,
    answer,
  };
}

export async function runQuery(question: string): Promise<void> {
  const config = loadConfig();

  const spinner = ora('Querying the catalog over MCP…').start();
  let session: ExploreSession;
  try {
    session = await openExplore(config.backendUrl);
  } catch (error) {
    spinner.fail('Could not reach the MCP explore endpoint');
    const reason = error instanceof Error ? error.message : String(error);
    printFailure([`MCP connection failed: ${reason}`], {
      command: 'query',
      status: 'failed',
      reason,
    });
    return;
  }

  let result: QueryResult;
  try {
    result = await runQueryWithSession(session, question);
  } catch (error) {
    spinner.fail('Query failed');
    const reason = error instanceof Error ? error.message : String(error);
    await session.close().catch(() => undefined);
    printFailure([`Query failed: ${reason}`], {
      command: 'query',
      status: 'failed',
      reason,
    });
    return;
  }
  await session.close().catch(() => undefined);

  if (result.status === 'failed') {
    spinner.fail('Query failed');
    printFailure([`Query failed: ${result.reason}`, result.answer], result);
    return;
  }

  spinner.succeed(`Found ${result.matchCount} match(es)`);
  printResult(
    [
      `Q: ${question}`,
      result.answer || 'No answer text returned.',
      `(${result.matchCount} match(es), ${result.relatedCount} related object(s))`,
    ],
    result,
  );
}

export interface AgentResult {
  command: 'agent';
  status: 'ready';
  mcpConfig: Record<string, unknown>;
}

/**
 * Emit the MCP client config a coding agent uses to connect to the catalog —
 * `type: 'http'` at the real explore URL. In single-tenant OSS the catalog is
 * queryable without credentials, so the entry carries no auth. No live call;
 * the agent owns the connection from here.
 */
export function buildAgentConfig(backendUrl: string): AgentResult {
  return {
    command: 'agent',
    status: 'ready',
    mcpConfig: mcpClientConfig(backendUrl),
  };
}

export function runAgent(): void {
  const config = loadConfig();
  const result = buildAgentConfig(config.backendUrl);

  printResult(
    [
      'Hand this MCP client config to your coding agent (e.g. .mcp.json):',
      JSON.stringify(result.mcpConfig, null, 2),
    ],
    result,
  );
}
