/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { FsStorage, StoredResponse, fixtureKey } from './storage';

export interface RecordedLog {
  target: string;
  operation: string;
  status?: string;
  requestBody?: unknown;
  responseBody?: unknown;
  responseHeaders?: Record<string, string>;
  error?: string;
}

export interface FixtureEntry {
  key: string;
  response: StoredResponse;
}

const SECRET_BODY_KEYS = new Set([
  'access_token',
  'refresh_token',
  'id_token',
  'token',
]);

function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(maskSecrets);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_BODY_KEYS.has(k) && typeof v === 'string'
          ? 'mock-token'
          : maskSecrets(v),
      ]),
    );
  }
  return value;
}

/**
 * Converts an execution's request logs into mock-server fixture entries.
 * `hosts` maps an integration's base URL to its mock path prefix (slug).
 * Repeated identical requests keep the first response.
 * ponytail: body-cursor pagination repeats one URL — replay then serves page 1
 * forever (capped by the engine's MAX_AUTO_PAGES); switch to ordered-consume
 * storage if a seed ever needs it.
 */
export function logsToFixtures(
  logs: RecordedLog[],
  hosts: Map<string, string>,
): { fixtures: FixtureEntry[]; skipped: number } {
  const seen = new Set<string>();
  const fixtures: FixtureEntry[] = [];
  let skipped = 0;

  for (const log of logs) {
    const host = [...hosts.keys()].find(h => log.target.startsWith(h));
    const status = Number(log.status);
    if (
      !host ||
      log.error ||
      !Number.isFinite(status) ||
      log.responseBody === undefined
    ) {
      skipped += 1;
      continue;
    }
    const rest = log.target.slice(host.length);
    const [path, query = ''] = rest.split('?');
    const key = fixtureKey(
      hosts.get(host) ?? '',
      log.operation,
      path,
      query,
      log.requestBody,
    );
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    fixtures.push({
      key,
      response: {
        status,
        body: maskSecrets(log.responseBody),
        ...(log.responseHeaders ? { headers: log.responseHeaders } : {}),
      },
    });
  }

  return { fixtures, skipped };
}

interface IntegrationRow {
  slug?: string;
  host?: string | null;
}

interface RequestLogsResponse {
  data?: RecordedLog[];
}

async function fetchJson<T>(url: string, tenant: string): Promise<T> {
  const res = await fetch(url, { headers: { 'x-tenant-id': tenant } });
  if (!res.ok) {
    throw new Error(`GET ${url} -> ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function recordExecution(options: {
  backendUrl: string;
  executionId: string;
  outDir: string;
  tenant?: string;
}): Promise<{ written: number; skipped: number }> {
  const { backendUrl, executionId, outDir, tenant = 'development' } = options;

  const integrations = await fetchJson<{ data?: IntegrationRow[] }>(
    `${backendUrl}/api/integrations`,
    tenant,
  );
  const hosts = new Map<string, string>();
  for (const row of integrations.data ?? []) {
    if (row.host && row.slug) {
      hosts.set(row.host.replace(/\/+$/, ''), row.slug);
    }
  }

  const logs = await fetchJson<RequestLogsResponse>(
    `${backendUrl}/api/catalog-workflow/executions/${executionId}/request-logs`,
    tenant,
  );

  const { fixtures, skipped } = logsToFixtures(logs.data ?? [], hosts);
  const storage = new FsStorage(outDir);
  for (const { key, response } of fixtures) {
    await storage.put(key, response);
  }
  return { written: fixtures.length, skipped };
}

if (process.argv[1]?.endsWith('record.ts')) {
  const [executionId, outDir] = process.argv.slice(2);
  if (!executionId || !outDir) {
    console.error(
      'Usage: tsx src/record.ts <executionId> <outDir> [BACKEND_URL / TENANT via env]',
    );
    process.exit(1);
  }
  recordExecution({
    backendUrl: process.env.BACKEND_URL ?? 'http://localhost:7008',
    executionId,
    outDir,
    tenant: process.env.TENANT,
  })
    .then(({ written, skipped }) => {
      console.log(`wrote ${written} fixtures (${skipped} skipped)`);
    })
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    });
}
