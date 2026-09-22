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

import { Knex } from 'knex';
import {
  RateLimiter,
  RateLimiterMetrics,
  RateLimiterMetricsCollector,
  AcquireTimeoutError,
} from './RateLimiterTypes';

export interface PostgresRateLimiterConfig {
  knex: Knex;
  integrationId: string;
  integrationName: string;
  requestsPerSecond: number;
  burst?: number;
  acquireTimeoutMs?: number;
  metricsCollector?: RateLimiterMetricsCollector;
  batchSize?: number;
}

interface RateLimitRow {
  integration_id: string;
  tokens_remaining: string;
  last_refill_at: Date;
  updated_at: Date;
}

export class PostgresRateLimiter implements RateLimiter {
  private readonly knex: Knex;
  private readonly integrationId: string;
  private readonly integrationName: string;
  private readonly requestsPerSecond: number;
  private readonly burst: number;
  private readonly defaultTimeoutMs: number;
  private readonly metricsCollector?: RateLimiterMetricsCollector;
  private readonly batchSize: number;
  private lastKnownRemainingTokens: number;
  private localTokens: number = 0;
  private destroyed = false;

  constructor(config: PostgresRateLimiterConfig) {
    this.knex = config.knex;
    this.integrationId = config.integrationId;
    this.integrationName = config.integrationName;
    this.requestsPerSecond = config.requestsPerSecond;
    this.burst = config.burst ?? config.requestsPerSecond;
    this.defaultTimeoutMs = config.acquireTimeoutMs ?? 30000;
    this.metricsCollector = config.metricsCollector;
    this.batchSize =
      config.batchSize ??
      Math.max(1, Math.ceil(config.requestsPerSecond * 0.5));
    this.lastKnownRemainingTokens = this.burst;
  }

  async acquire(timeoutMs?: number): Promise<void> {
    if (this.destroyed) {
      throw new Error('PostgresRateLimiter has been destroyed');
    }

    if (this.localTokens > 0) {
      this.localTokens--;
      this.emitMetrics();
      return;
    }

    const timeout = timeoutMs ?? this.defaultTimeoutMs;
    const startTime = Date.now();

    let acquired = false;
    while (!acquired) {
      acquired = await this.tryAcquireFromDb();

      if (acquired) {
        this.emitMetrics();
        return;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed >= timeout) {
        throw new AcquireTimeoutError(
          `Failed to acquire token within ${timeout}ms`,
          elapsed,
          timeout,
        );
      }

      const waitTime = Math.min(100, timeout - elapsed);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  tryAcquire(): boolean {
    if (this.destroyed) {
      return false;
    }
    if (this.localTokens > 0) {
      this.localTokens--;
      return true;
    }
    return false;
  }

  availableTokens(): number {
    return this.localTokens + this.lastKnownRemainingTokens;
  }

  backoff(): void {
    this.localTokens = 0;
  }

  getMetrics(): RateLimiterMetrics {
    return {
      availableTokens: this.localTokens + this.lastKnownRemainingTokens,
      queueDepth: 0,
      estimatedWaitTimeMs: 0,
    };
  }

  async destroy(): Promise<void> {
    this.destroyed = true;

    if (this.metricsCollector) {
      this.metricsCollector.removeMetrics(
        this.integrationId,
        this.integrationName,
      );
    }

    await this.knex('rate_limit_state')
      .where('integration_id', this.integrationId)
      .delete();
  }

  private async tryAcquireFromDb(): Promise<boolean> {
    try {
      return await this.knex.transaction(async trx => {
        let row = await trx<RateLimitRow>('rate_limit_state')
          .where('integration_id', this.integrationId)
          .forUpdate()
          .first();

        const now = new Date();

        if (!row) {
          const tokensToReserve = Math.min(this.burst, this.batchSize);
          const updatedTokens = this.burst - tokensToReserve;

          const insertResult = await trx.raw(
            `INSERT INTO rate_limit_state (integration_id, tokens_remaining, last_refill_at, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (integration_id) DO NOTHING
             RETURNING *`,
            [this.integrationId, String(updatedTokens), now, now],
          );

          if (insertResult.rows && insertResult.rows.length > 0) {
            this.localTokens = tokensToReserve - 1;
            this.lastKnownRemainingTokens = updatedTokens;
            return true;
          }

          row = await trx<RateLimitRow>('rate_limit_state')
            .where('integration_id', this.integrationId)
            .forUpdate()
            .first();

          if (!row) {
            return false;
          }
        }

        const tokensRemaining = parseFloat(row.tokens_remaining);
        const lastRefillAt = new Date(row.last_refill_at);
        const elapsedSeconds = (now.getTime() - lastRefillAt.getTime()) / 1000;

        const tokensToAdd = elapsedSeconds * this.requestsPerSecond;
        const newTokens = Math.min(this.burst, tokensRemaining + tokensToAdd);

        if (newTokens >= 1) {
          const tokensToReserve = Math.min(
            Math.floor(newTokens),
            this.batchSize,
          );
          const updatedTokens = newTokens - tokensToReserve;

          await trx<RateLimitRow>('rate_limit_state')
            .where('integration_id', this.integrationId)
            .update({
              tokens_remaining: String(updatedTokens),
              last_refill_at: now,
              updated_at: now,
            });

          this.localTokens = tokensToReserve - 1;
          this.lastKnownRemainingTokens = updatedTokens;
          return true;
        }

        this.lastKnownRemainingTokens = newTokens;
        return false;
      });
    } catch (error) {
      throw new Error(`Failed to acquire token from database: ${error}`);
    }
  }

  private emitMetrics(): void {
    if (!this.metricsCollector) {
      return;
    }

    this.metricsCollector.updateMetrics(
      this.integrationId,
      this.integrationName,
      {
        availableTokens: this.localTokens + this.lastKnownRemainingTokens,
        queueDepth: 0,
        estimatedWaitTimeMs: 0,
      },
    );
  }
}
