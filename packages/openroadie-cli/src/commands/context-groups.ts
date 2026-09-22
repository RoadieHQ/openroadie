import ora from 'ora';
import { loadConfig } from '../config';
import { httpFailureReason, OpenRoadieHttpClient } from '../http-client';
import { printResult, printFailure } from '../print';
import { ENDPOINTS } from '../status';

/**
 * Context groups — pre-materialized clusters of related objects. A rule names a
 * set of datasources; each of their objects becomes a group, and objects
 * related by the merge relationship types are folded into one group (so
 * merging only pays off AFTER relationships exist). Thin client of
 * `/api/catalog-datastore/context-groups/rules`. Optional-but-recommended: with
 * groups, one agent query returns a whole bundle (a person + their GitHub/
 * Shortcut/PagerDuty identities) instead of a manual graph walk.
 */
export interface DatasourceFilter {
  datasourceId: string;
  filter?: string;
}

export interface CreateContextGroupRuleInput {
  name: string;
  description?: string;
  datasources: DatasourceFilter[];
  mergeRelationshipTypes?: string[];
}

export interface ContextGroupRuleRow {
  id: string;
  name?: string;
  mergeRelationshipTypes?: string[];
}

export interface ContextGroupRuleResult {
  command: 'context-groups create';
  status: 'created' | 'failed';
  rule?: ContextGroupRuleRow;
  reason?: string;
}

export interface ContextGroupsListResult {
  command: 'context-groups list';
  status: 'ok' | 'failed';
  rules: ContextGroupRuleRow[];
  reason?: string;
}

export async function createContextGroupRule(
  client: OpenRoadieHttpClient,
  input: CreateContextGroupRuleInput,
): Promise<ContextGroupRuleResult> {
  const body = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  const res = await client.post<ContextGroupRuleRow>(
    ENDPOINTS.contextGroupRules,
    body,
  );
  if (!res.ok || !res.body?.id) {
    return {
      command: 'context-groups create',
      status: 'failed',
      reason: httpFailureReason(res),
    };
  }
  return {
    command: 'context-groups create',
    status: 'created',
    rule: res.body,
  };
}

export async function listContextGroupRules(
  client: OpenRoadieHttpClient,
): Promise<ContextGroupsListResult> {
  const res = await client.get<{
    data?: ContextGroupRuleRow[];
    items?: ContextGroupRuleRow[];
  }>(`${ENDPOINTS.contextGroupRules}?limit=200`);
  if (!res.ok) {
    return {
      command: 'context-groups list',
      status: 'failed',
      rules: [],
      reason: httpFailureReason(res),
    };
  }
  return {
    command: 'context-groups list',
    status: 'ok',
    rules: res.body?.data ?? res.body?.items ?? [],
  };
}

export async function runContextGroupsCreate(
  input: CreateContextGroupRuleInput,
): Promise<void> {
  const client = new OpenRoadieHttpClient(loadConfig());
  const spinner = ora('Creating context-group rule…').start();
  const result = await createContextGroupRule(client, input);
  if (result.status === 'failed') {
    spinner.fail('Could not create context-group rule');
    printFailure(
      [`Failed to create context-group rule: ${result.reason ?? ''}`.trim()],
      result,
    );
    return;
  }
  spinner.succeed(`Created context-group rule "${result.rule?.name}"`);
  printResult(
    [
      `Rule ${result.rule?.id} — materializing groups from existing relationships.`,
    ],
    result,
  );
}

export async function runContextGroupsList(): Promise<void> {
  const client = new OpenRoadieHttpClient(loadConfig());
  const spinner = ora('Loading context-group rules…').start();
  const result = await listContextGroupRules(client);
  if (result.status === 'failed') {
    spinner.fail('Could not list context-group rules');
    printFailure(
      [`Failed to list context-group rules: ${result.reason ?? ''}`.trim()],
      result,
    );
    return;
  }
  spinner.stop();
  printResult(
    result.rules.length === 0
      ? ['No context-group rules yet.']
      : result.rules.map(r => `  ${r.name} (${r.id})`),
    result,
  );
}
