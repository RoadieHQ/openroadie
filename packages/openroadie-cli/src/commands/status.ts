import ora from 'ora';
import { loadConfig } from '../config';
import { printResult, printFailure } from '../print';
import { computeStatus } from '../status';
import type { StatusPayload } from '../status';

/**
 * Human-readable integration line: name the connected ones (the few the user
 * set up), then count the rest. Dumping all ~29 raw UUIDs is unreadable and
 * implies they're addressable here — they aren't (connect takes a slug).
 */
function formatIntegrations(
  integrations: StatusPayload['integrations'],
): string {
  if (integrations.length === 0) {
    return 'none';
  }
  const connected = integrations.filter(item => item.connected);
  const rest = integrations.length - connected.length;
  if (connected.length === 0) {
    return `none connected · ${integrations.length} available`;
  }
  const names = connected.map(item => item.name).join(', ');
  return rest > 0
    ? `${names} connected · ${rest} more available`
    : `${names} connected`;
}

/**
 * The one fully-wired M0 verb: fan out across the live OSS endpoints and report
 * server / integrations / sources / index / rules plus the next command to run.
 * Reads nothing from disk except `{ backendUrl }`.
 */
export async function runStatus(): Promise<void> {
  const config = loadConfig();
  const spinner = ora('Reading OpenRoadie status…').start();

  let payload;
  try {
    payload = await computeStatus(config);
  } catch (error: unknown) {
    spinner.fail('Could not compute status');
    const reason = error instanceof Error ? error.message : String(error);
    printFailure([`Failed to compute status: ${reason}`], {
      command: 'status',
      status: 'failed',
      reason,
    });
    return;
  }
  spinner.stop();

  const lines = [
    'OpenRoadie install status',
    `Server: ${
      payload.server
        ? `running at ${payload.server.url}`
        : 'not reachable (run: openroadie up)'
    }`,
    `Integrations: ${formatIntegrations(payload.integrations)}`,
    `Sources enabled: ${payload.sources.enabled.length}/${payload.sources.available.length}`,
    `Indexed: ${
      payload.indexed.done ? `yes (${payload.indexed.objects} objects)` : 'no'
    }`,
    `Rules: ${payload.rules.suggested} suggested, ${payload.rules.approved} approved`,
    ...(payload.failedRoutes.length > 0
      ? [
          `Status dependencies: ${payload.failedRoutes
            .map(route => `${route.route} (${route.reason})`)
            .join(', ')}`,
        ]
      : []),
    `Next recommended step: ${payload.nextStep}`,
  ];

  printResult(lines, payload);
}
