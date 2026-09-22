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

import type {
  DiscoveryService,
  InternalFetchApi,
  LoggerService,
} from '@roadiehq/extensions-api';

export type IntegrationUsageKind =
  | 'data-source'
  | 'action'
  | 'relationship-rule';

export interface IntegrationUsageRef {
  kind: IntegrationUsageKind;
  id: string;
  name: string;
  slug?: string;
}

export interface IntegrationUsage {
  references: IntegrationUsageRef[];
  /**
   * Plugins whose probe could not be reached or refused. A non-empty value
   * means "unknown", never "no usage" — callers must not delete on it.
   */
  unavailable: string[];
}

interface Probe {
  kind: IntegrationUsageKind;
  pluginId: string;
  /** Path under the plugin's base URL, with `:integrationId` appended. */
  path: string;
}

/**
 * The three places an integration id can be referenced. Each plugin owns its
 * own database (in OSS, `pluginDivisionMode: 'database'` gives each a separate
 * one), so this goes over HTTP through discovery rather than a cross-table
 * query — the same pattern `ActionsController` and `ContextGroupDao` already
 * use to reach across plugins.
 *
 * Each probe is a purpose-built endpoint rather than the plugin's generic list:
 * those apply row-level scope narrowing, so a narrowed caller would see a
 * subset and the guard would under-report — a false "safe to delete".
 */
const PROBES: Probe[] = [
  {
    kind: 'data-source',
    pluginId: 'catalog-workflow',
    path: '/workflows/integration-usage',
  },
  { kind: 'action', pluginId: 'actions', path: '/integration-usage' },
  {
    kind: 'relationship-rule',
    pluginId: 'catalog-datastore',
    path: '/relationship-rules/integration-usage',
  },
];

export interface IntegrationUsageServiceOptions {
  discovery: DiscoveryService;
  logger: LoggerService;
  /**
   * Credential-resolving fetch for internal calls
   * (`internalFetchServiceRef`). Ambient, not `asService()`: each probe must
   * stay bounded by the caller's own grants, so a narrowed token can't learn
   * about resources it may not read.
   */
  internalFetch: InternalFetchApi;
}

/**
 * Finds everything that would break if an integration were deleted.
 *
 * Backs a fail-closed delete guard: an integration delete is irreversible and
 * its damage is silent and deferred — a dangling `integrationId` surfaces at
 * the next scheduled run, at execute time, or as edges that quietly stop
 * appearing, none of it attributed back to the delete.
 */
export class IntegrationUsageService {
  private readonly discovery: DiscoveryService;
  private readonly logger: LoggerService;
  private readonly internalFetch: InternalFetchApi;

  constructor(options: IntegrationUsageServiceOptions) {
    this.discovery = options.discovery;
    this.logger = options.logger;
    this.internalFetch = options.internalFetch;
  }

  async findUsage(integrationId: string): Promise<IntegrationUsage> {
    const results = await Promise.allSettled(
      PROBES.map(probe => this.probe(probe, integrationId)),
    );

    const references: IntegrationUsageRef[] = [];
    const unavailable: string[] = [];
    results.forEach((result, index) => {
      const probe = PROBES[Number(index)];
      if (result.status === 'fulfilled') {
        references.push(...result.value);
      } else {
        unavailable.push(probe.pluginId);
        this.logger.warn(
          `Integration usage probe failed for ${probe.pluginId}: ${
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason)
          }`,
        );
      }
    });

    return { references, unavailable };
  }

  private async probe(
    probe: Probe,
    integrationId: string,
  ): Promise<IntegrationUsageRef[]> {
    const baseUrl = await this.discovery.getBaseUrl(probe.pluginId);
    // Credentials are the fetch's job: it forwards the inbound caller's
    // headers (including the tenant partition key) from async-local context,
    // or mints a service token outside a request.
    const response = await this.internalFetch.fetch(
      `${baseUrl}${probe.path}/${encodeURIComponent(integrationId)}`,
    );
    if (!response.ok) {
      throw new Error(
        `${probe.pluginId} responded ${response.status} ${response.statusText}`,
      );
    }
    const payload = (await response.json()) as {
      items?: Array<{ id?: string; name?: string; slug?: string }>;
    };
    return (payload.items ?? [])
      .filter(item => typeof item.id === 'string')
      .map(item => ({
        kind: probe.kind,
        id: item.id as string,
        name: item.name ?? (item.id as string),
        ...(item.slug ? { slug: item.slug } : {}),
      }));
  }
}
