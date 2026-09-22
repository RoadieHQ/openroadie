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
import {
  ATTEMPT_STAGING_GRACE_MS,
  ATTEMPT_STALE_AFTER_MS,
} from '@roadiehq/catalog-datastore-common';
import { WorkflowAttemptDao } from './WorkflowAttemptDao';
import { WorkflowStagingDao } from './WorkflowStagingDao';

export interface AttemptReaperOptions {
  attemptDao: WorkflowAttemptDao;
  stagingDao: WorkflowStagingDao;
  logger: LoggerService;
  staleAfterMs?: number;
  stagingGraceMs?: number;
}

/**
 * Supersedes attempts with expired heartbeats and clears resting attempts'
 * staging after the grace period. Driven by an external scheduler (call
 * `runTick` per tick) rather than its own timer, so multi-tenant hosts can
 * run each tick inside a tenant context.
 */
export class AttemptReaper {
  private readonly attemptDao: WorkflowAttemptDao;
  private readonly stagingDao: WorkflowStagingDao;
  private readonly logger: LoggerService;
  private readonly staleAfterMs: number;
  private readonly stagingGraceMs: number;

  constructor(options: AttemptReaperOptions) {
    this.attemptDao = options.attemptDao;
    this.stagingDao = options.stagingDao;
    this.logger = options.logger.child({ name: 'AttemptReaper' });
    this.staleAfterMs = options.staleAfterMs ?? ATTEMPT_STALE_AFTER_MS;
    this.stagingGraceMs = options.stagingGraceMs ?? ATTEMPT_STAGING_GRACE_MS;
  }

  async runTick(): Promise<{ superseded: number; cleaned: number }> {
    const stale = await this.attemptDao.supersedeStale(this.staleAfterMs);
    const superseded = stale.length;
    if (superseded > 0) {
      this.logger.warn(
        `Superseded ${superseded} stale attempt(s) with an expired heartbeat`,
      );
    }

    const reapable = await this.attemptDao.listReapableAttempts(
      this.stagingGraceMs,
    );
    let cleaned = 0;
    for (const attempt of reapable) {
      await this.stagingDao.deleteAttempt(
        attempt.executionId,
        attempt.attemptId,
      );
      await this.attemptDao.markStagingReaped(
        attempt.executionId,
        attempt.attemptId,
      );
      cleaned += 1;
    }
    return { superseded, cleaned };
  }
}
