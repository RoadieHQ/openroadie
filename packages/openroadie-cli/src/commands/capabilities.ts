import ora from 'ora';
import { loadConfig } from '../config';
import { httpFailureReason, OpenRoadieHttpClient } from '../http-client';
import { printResult, printFailure } from '../print';
import { ENDPOINTS } from '../status';

/**
 * Capabilities — reusable, agent-queryable instruction sets ({name, description,
 * instructions}). Thin client of `/api/capabilities`, the same route the MCP
 * `manage_capability_create` tool uses. Optional-but-recommended install step: seeding
 * a capability makes the catalog's capability library non-empty so an agent can
 * discover documented procedures instead of re-deriving them each session.
 */
export interface CapabilityRow {
  id: string;
  name?: string;
  description?: string;
  currentVersion?: number;
}

export interface CreateCapabilityInput {
  name: string;
  description: string;
  instructions: string;
}

export interface CapabilityResult {
  command: 'capabilities create';
  status: 'created' | 'failed';
  capability?: CapabilityRow;
  reason?: string;
}

export interface CapabilitiesListResult {
  command: 'capabilities list';
  status: 'ok' | 'failed';
  capabilities: CapabilityRow[];
  reason?: string;
}

export async function createCapability(
  client: OpenRoadieHttpClient,
  input: CreateCapabilityInput,
): Promise<CapabilityResult> {
  const res = await client.post<CapabilityRow>(ENDPOINTS.capabilities, input);
  if (!res.ok || !res.body?.id) {
    return {
      command: 'capabilities create',
      status: 'failed',
      reason: httpFailureReason(res),
    };
  }
  return {
    command: 'capabilities create',
    status: 'created',
    capability: res.body,
  };
}

export async function listCapabilities(
  client: OpenRoadieHttpClient,
): Promise<CapabilitiesListResult> {
  const res = await client.get<{
    data?: CapabilityRow[];
    items?: CapabilityRow[];
  }>(`${ENDPOINTS.capabilities}?limit=200`);
  if (!res.ok) {
    return {
      command: 'capabilities list',
      status: 'failed',
      capabilities: [],
      reason: httpFailureReason(res),
    };
  }
  return {
    command: 'capabilities list',
    status: 'ok',
    capabilities: res.body?.data ?? res.body?.items ?? [],
  };
}

export async function runCapabilitiesCreate(
  input: CreateCapabilityInput,
): Promise<void> {
  const client = new OpenRoadieHttpClient(loadConfig());
  const spinner = ora('Creating capability…').start();
  const result = await createCapability(client, input);
  if (result.status === 'failed') {
    spinner.fail('Could not create capability');
    printFailure(
      [`Failed to create capability: ${result.reason ?? ''}`.trim()],
      result,
    );
    return;
  }
  spinner.succeed(`Created capability "${result.capability?.name}"`);
  printResult([`Capability ${result.capability?.id}.`], result);
}

export async function runCapabilitiesList(): Promise<void> {
  const client = new OpenRoadieHttpClient(loadConfig());
  const spinner = ora('Loading capabilities…').start();
  const result = await listCapabilities(client);
  if (result.status === 'failed') {
    spinner.fail('Could not list capabilities');
    printFailure(
      [`Failed to list capabilities: ${result.reason ?? ''}`.trim()],
      result,
    );
    return;
  }
  spinner.stop();
  printResult(
    result.capabilities.length === 0
      ? ['No capabilities yet.']
      : result.capabilities.map(c => `  ${c.name} (${c.id})`),
    result,
  );
}
