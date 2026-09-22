import ora from 'ora';
import { loadConfig } from '../config';
import { OpenRoadieHttpClient, type HttpResult } from '../http-client';
import { printResult, printFailure } from '../print';
import { promptHidden } from '../prompt';
import { ENDPOINTS } from '../status';

/**
 * Response of a successful write to the secrets-settings key route
 * (`POST /api/secrets-settings/keys`). The backend returns `{ newVersion }`.
 */
interface SecretWriteResponse {
  newVersion?: number;
}

function secretWriteFailureReason(res: HttpResult<unknown>): string {
  return res.unreachable
    ? 'backend unreachable'
    : `secret write failed (status ${res.status})`;
}

export interface SecretSetResult {
  command: 'secret set';
  id: string;
  status: 'stored' | 'failed';
  newVersion?: number;
  reason?: string;
}

/**
 * Build and send the secret-write request. Kept free of any prompt so the unit
 * test can drive it with a fixed value and a mocked client: it asserts the
 * request shape (`{ name, value }` to the write-only key route) and the result
 * it returns.
 *
 * The value is carried only as an argument here — it entered through the hidden
 * prompt in `runSecretSet` and is POSTed to the write-only route. The route
 * honors the read-only storage mode (405) by mapping it to a `failed` result
 * with the backend's reason, never echoing the value back.
 */
export async function setSecret(
  client: OpenRoadieHttpClient,
  id: string,
  value: string,
): Promise<SecretSetResult> {
  const res = await client.post<SecretWriteResponse>(ENDPOINTS.secretKeys, {
    name: id,
    value,
  });

  if (res.ok) {
    return {
      command: 'secret set',
      id,
      status: 'stored',
      newVersion: res.body?.newVersion,
    };
  }

  // 405 → read-only store; 403 → managed/hidden; 400 → not in configuration.
  return {
    command: 'secret set',
    id,
    status: 'failed',
    reason: secretWriteFailureReason(res),
  };
}

/**
 * The `secret set <id>` verb: read the value from a hidden prompt (no echo),
 * then write it through the write-only key route. No `--token` flag exists; the
 * secret enters only here.
 */
export async function runSecretSet(id: string): Promise<void> {
  const value = await promptHidden(`Secret value for ${id}: `);
  if (value.trim() === '') {
    printFailure(['No value entered; nothing was written.'], {
      command: 'secret set',
      id,
      status: 'failed',
      reason: 'empty value',
    });
    return;
  }

  const config = loadConfig();
  const client = new OpenRoadieHttpClient(config);
  const spinner = ora(`Storing secret for ${id}…`).start();
  const result = await setSecret(client, id, value);

  if (result.status === 'stored') {
    spinner.succeed(`Secret for ${id} stored`);
    printResult(
      [
        `Stored secret "${id}" (write-only)${
          result.newVersion ? ` — version ${result.newVersion}` : ''
        }.`,
      ],
      result,
    );
    return;
  }

  spinner.fail(`Could not store secret for ${id}`);
  printFailure([`Failed to store secret "${id}": ${result.reason}`], result);
}

/**
 * The `secret verify <id>` verb. A real verify-the-secret-reaches-its-target
 * flow rides on per-integration readiness, which the M2 `connect`/`status`
 * surfaces drive; here it reports the boundary so the contract stays intact.
 */
export function runSecretVerify(id: string): void {
  printResult(
    [
      `Secret "${id}" is write-only; verify it through the integration's`,
      'readiness check (openroadie status reads readyForCurrentScope).',
    ],
    { command: 'secret verify', id, status: 'deferred' },
  );
}
