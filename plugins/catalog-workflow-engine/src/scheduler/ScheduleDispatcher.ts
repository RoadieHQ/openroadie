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
import { ScheduleStateDao } from '@roadiehq/catalog-workflow-data';
import { ScheduleDispatchTarget } from './ScheduleDispatchTarget';

export const DEFAULT_DISPATCH_INTERVAL_MS = 5_000;
export const DEFAULT_DISPATCH_BATCH_LIMIT = 50;
/** Lease must exceed max execution timeout so reaper never kills a live run. */
export const MIN_EXECUTION_LEASE_MS = 35 * 60 * 1000;
export const DEFAULT_EXECUTION_LEASE_MS = MIN_EXECUTION_LEASE_MS;

export interface ScheduleDispatcherOptions {
  scheduleStateDao: ScheduleStateDao;
  dispatchTarget: ScheduleDispatchTarget;
  logger: LoggerService;
  intervalMs?: number;
  batchLimit?: number;
  leaseMs?: number;
  holderId?: string;
}

export class ScheduleDispatcher {
  private readonly scheduleStateDao: ScheduleStateDao;
  private readonly dispatchTarget: ScheduleDispatchTarget;
  private readonly logger: LoggerService;
  private readonly intervalMs: number;
  private readonly batchLimit: number;
  private readonly leaseMs: number;
  private readonly holderId: string;

  private running = false;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(options: ScheduleDispatcherOptions) {
    this.scheduleStateDao = options.scheduleStateDao;
    this.dispatchTarget = options.dispatchTarget;
    this.logger = options.logger.child({ name: 'ScheduleDispatcher' });
    this.intervalMs = options.intervalMs ?? DEFAULT_DISPATCH_INTERVAL_MS;
    this.batchLimit = options.batchLimit ?? DEFAULT_DISPATCH_BATCH_LIMIT;
    const configuredLeaseMs = options.leaseMs ?? DEFAULT_EXECUTION_LEASE_MS;
    this.leaseMs = Math.max(configuredLeaseMs, MIN_EXECUTION_LEASE_MS);
    if (configuredLeaseMs < MIN_EXECUTION_LEASE_MS) {
      this.logger.warn(
        `Configured execution lease ${configuredLeaseMs}ms is below minimum ${MIN_EXECUTION_LEASE_MS}ms; using ${MIN_EXECUTION_LEASE_MS}ms`,
      );
    }
    this.holderId = options.holderId ?? 'in-process-dispatcher';
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.logger.info(
      `Schedule dispatcher started (interval ${this.intervalMs}ms, batch ${this.batchLimit})`,
    );
    this.scheduleNextTick(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.running) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.runTick();
    }, delayMs);
  }

  async runTick(): Promise<void> {
    try {
      await this.scheduleStateDao.reapExpired();
      const due = await this.scheduleStateDao.claimDue({
        limit: this.batchLimit,
        leaseMs: this.leaseMs,
        holderId: this.holderId,
      });
      for (const row of due) {
        void this.dispatchTarget.dispatch(row).catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Dispatch failed for schedule ${row.datasourceId}: ${message}`,
          );
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Schedule dispatch tick failed: ${message}`);
    } finally {
      this.scheduleNextTick(this.intervalMs);
    }
  }
}
