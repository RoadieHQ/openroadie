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
import { LoggerService } from '@roadiehq/extensions-api';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import { WebhookSubscriptionDao } from '../database/WebhookSubscriptionDao';
import { DatasourceEvents } from './DatasourceEvents';
import { SIGNATURE_HEADER, signBody } from './signing';

const DEFAULT_DEBOUNCE_MS = 2_000;
const DEFAULT_RETRY_DELAYS_MS = [1_000, 5_000, 30_000];
const WEBHOOK_EVENT_NAME = 'datasource-updated';
const DATASOURCES_PLUGIN_ID = 'datasources';

interface WebhookPayload {
  event: typeof WEBHOOK_EVENT_NAME;
  metadata: {
    datasourceId: string;
    status: 'success';
  };
  timestamp: string;
}

interface DatasourceFilters {
  pluginId?: string;
}

export interface WebhookEmitterOptions {
  logger: LoggerService;
  subscriptionDao: WebhookSubscriptionDao;
  events: DatasourceEvents;
  fetchImpl?: typeof fetch;
  debounceMs?: number;
  retryDelaysMs?: number[];
  workspaceExists?: (workspaceId: string) => Promise<boolean>;
}

export class WebhookEmitter {
  private readonly logger: LoggerService;
  private readonly subscriptionDao: WebhookSubscriptionDao;
  private readonly fetchImpl: typeof fetch;
  private readonly debounceMs: number;
  private readonly retryDelaysMs: number[];
  private readonly workspaceExists: (workspaceId: string) => Promise<boolean>;
  private readonly pending = new Map<
    string,
    { timer: NodeJS.Timeout; datasourceId: string; workspaceId: string }
  >();
  private unsubscribe?: () => void;

  constructor(options: WebhookEmitterOptions) {
    this.logger = options.logger;
    this.subscriptionDao = options.subscriptionDao;
    // eslint-disable-next-line no-restricted-syntax -- external target: webhook deliveries go to subscriber-owned URLs; `fetchImpl` is a test seam, not a credential seam.
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.workspaceExists =
      options.workspaceExists ??
      (async workspaceId => workspaceId === DEFAULT_WORKSPACE_ID);
    this.unsubscribe = options.events.onChanged((id, workspaceId) =>
      this.schedule(id, workspaceId),
    );
  }

  /** For graceful shutdown / test cleanup. */
  stop(): void {
    this.unsubscribe?.();
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  /**
   * Trailing-edge debounce per datasourceId: each event resets the timer, so
   * we fire 2s after the LAST event in a burst. Bulk imports of N items =
   * one webhook.
   */
  schedule(datasourceId: string, workspaceId = DEFAULT_WORKSPACE_ID): void {
    const key = `${workspaceId}:${datasourceId}`;
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.pending.delete(key);
      this.fire(datasourceId, workspaceId).catch(err => {
        this.logger.error(
          `Webhook fire failed for datasource ${datasourceId}: ${err}`,
        );
      });
    }, this.debounceMs);
    this.pending.set(key, { timer, datasourceId, workspaceId });
  }

  /** Test helper: await all pending debounced fires. */
  async flushNow(): Promise<void> {
    const entries = [...this.pending.entries()];
    for (const [key, pending] of entries) {
      clearTimeout(pending.timer);
      this.pending.delete(key);
      await this.fire(pending.datasourceId, pending.workspaceId);
    }
  }

  private async fire(datasourceId: string, workspaceId: string): Promise<void> {
    if (!(await this.workspaceExists(workspaceId))) {
      return;
    }
    const subscriptions = await this.subscriptionDao.list(workspaceId);
    const matched = subscriptions.filter(sub => {
      const filters = sub.filters as DatasourceFilters;
      return !filters.pluginId || filters.pluginId === DATASOURCES_PLUGIN_ID;
    });
    if (matched.length === 0) return;

    const payload: WebhookPayload = {
      event: WEBHOOK_EVENT_NAME,
      metadata: { datasourceId, status: 'success' },
      timestamp: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);

    await Promise.all(
      matched.map(sub =>
        this.deliverWithRetry(sub.url, sub.secret, body, workspaceId),
      ),
    );
  }

  private async deliverWithRetry(
    url: string,
    secret: string,
    body: string,
    workspaceId: string,
  ): Promise<void> {
    const signature = signBody(secret, body);
    const attempts = 1 + this.retryDelaysMs.length;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (!(await this.workspaceExists(workspaceId))) {
        return;
      }
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [SIGNATURE_HEADER]: signature,
          },
          body,
        });
        if (res.ok) return;
        if (res.status === 401) {
          this.logger.warn(
            `Webhook to ${url} rejected with 401 (bad signature) — not retrying`,
          );
          return;
        }
        if (res.status >= 400 && res.status < 500 && res.status !== 408) {
          this.logger.warn(
            `Webhook to ${url} rejected with ${res.status} — not retrying`,
          );
          return;
        }
        this.logger.warn(
          `Webhook to ${url} returned ${res.status} (attempt ${attempt + 1}/${attempts})`,
        );
      } catch (err) {
        this.logger.warn(
          `Webhook to ${url} threw "${(err as Error).message}" (attempt ${
            attempt + 1
          }/${attempts})`,
        );
      }

      const delay = this.retryDelaysMs.at(attempt);
      if (delay !== undefined) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    this.logger.error(
      `Webhook to ${url} exhausted ${attempts} attempts; dropping event`,
    );
  }
}
