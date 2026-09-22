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

import { describe, expect, it, vi } from 'vitest';
import {
  MIN_EXECUTION_LEASE_MS,
  ScheduleDispatcher,
} from './ScheduleDispatcher';

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as any;

const claimed = (id: string) => ({
  datasourceId: id,
  dispatchToken: `token-${id}`,
});

describe('ScheduleDispatcher', () => {
  it('reaps before claiming and dispatches each claimed row', async () => {
    const order: string[] = [];
    const scheduleStateDao = {
      reapExpired: vi.fn(async () => {
        order.push('reap');
        return 0;
      }),
      claimDue: vi.fn(async () => {
        order.push('claim');
        return [claimed('a'), claimed('b')];
      }),
    } as any;
    const dispatchTarget = { dispatch: vi.fn().mockResolvedValue(undefined) };

    const dispatcher = new ScheduleDispatcher({
      scheduleStateDao,
      dispatchTarget,
      logger,
    });

    await dispatcher.runTick();
    await Promise.resolve();

    expect(order).toEqual(['reap', 'claim']);
    expect(dispatchTarget.dispatch).toHaveBeenCalledTimes(2);
    expect(dispatchTarget.dispatch).toHaveBeenCalledWith(claimed('a'));
    expect(dispatchTarget.dispatch).toHaveBeenCalledWith(claimed('b'));
  });

  it('isolates a failing dispatch from the rest of the batch', async () => {
    const scheduleStateDao = {
      reapExpired: vi.fn().mockResolvedValue(0),
      claimDue: vi.fn().mockResolvedValue([claimed('a'), claimed('b')]),
    } as any;
    const dispatchTarget = {
      dispatch: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined),
    };

    const dispatcher = new ScheduleDispatcher({
      scheduleStateDao,
      dispatchTarget,
      logger,
    });

    await expect(dispatcher.runTick()).resolves.toBeUndefined();
    await Promise.resolve();
    expect(dispatchTarget.dispatch).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalled();
  });

  it('does not schedule another tick after stop()', async () => {
    const scheduleStateDao = {
      reapExpired: vi.fn().mockResolvedValue(0),
      claimDue: vi.fn().mockResolvedValue([]),
    } as any;
    const dispatcher = new ScheduleDispatcher({
      scheduleStateDao,
      dispatchTarget: { dispatch: vi.fn() },
      logger,
      intervalMs: 10,
    });

    await dispatcher.stop();
    // With running=false a manual tick must not arm a follow-up timer.
    await dispatcher.runTick();
    expect((dispatcher as any).timer).toBeUndefined();
  });

  it('clamps too-small configured lease to minimum', async () => {
    const scheduleStateDao = {
      reapExpired: vi.fn().mockResolvedValue(0),
      claimDue: vi.fn().mockResolvedValue([]),
    } as any;
    const dispatcher = new ScheduleDispatcher({
      scheduleStateDao,
      dispatchTarget: { dispatch: vi.fn() },
      logger,
      leaseMs: 1_000,
    });

    await dispatcher.runTick();

    expect(scheduleStateDao.claimDue).toHaveBeenCalledWith(
      expect.objectContaining({ leaseMs: MIN_EXECUTION_LEASE_MS }),
    );
  });
});
