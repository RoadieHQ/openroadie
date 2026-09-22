/*
 * Copyright 2022 The Backstage Authors
 * Modifications copyright 2026 Larder Software Limited
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
 *
 * Derived from Backstage (https://github.com/backstage/backstage),
 * packages/backend-defaults/src/entrypoints/scheduler/lib/LocalTaskWorker.test.ts at v1.47.1, and modified.
 */

import { vi } from 'vitest';

import { LocalTaskWorker } from './LocalTaskWorker';
import { mockServices } from '@roadiehq/backend-test-utils';

describe('LocalTaskWorker', () => {
  const logger = mockServices.logger.mock();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the happy path (with iso duration) and handles cancellation', async () => {
    const fn = vi.fn();
    const controller = new AbortController();

    const worker = new LocalTaskWorker('a', fn, logger);
    worker.start(
      {
        version: 2,
        initialDelayDuration: 'PT0.2S',
        cadence: 'PT0.2S',
        timeoutAfterDuration: 'PT1S',
      },
      { signal: controller.signal },
    );

    expect(fn).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(2);
    controller.abort();
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('runs the happy path (with a cron expression) and handles cancellation', async () => {
    const fn = vi.fn();
    const controller = new AbortController();

    // Cron is wall clock based, so pin the (faked) clock just past a second
    // boundary to make the schedule deterministic
    vi.setSystemTime(new Date('2026-01-01T00:00:00.010Z'));

    const worker = new LocalTaskWorker('a', fn, logger);
    worker.start(
      {
        version: 2,
        initialDelayDuration: 'PT0.2S',
        cadence: '* * * * * *',
        timeoutAfterDuration: 'PT1S',
      },
      { signal: controller.signal },
    );

    expect(fn).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('can trigger to abort wait', async () => {
    const fn = vi.fn();
    const controller = new AbortController();

    const worker = new LocalTaskWorker('a', fn, logger);
    worker.start(
      {
        version: 2,
        initialDelayDuration: 'PT0.2S',
        cadence: 'PT0.2S',
        timeoutAfterDuration: 'PT1S',
      },
      { signal: controller.signal },
    );

    expect(fn).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(fn).toHaveBeenCalledTimes(1);
    worker.trigger();
    await vi.advanceTimersByTimeAsync(10);
    expect(fn).toHaveBeenCalledTimes(2);
    controller.abort();
  });
});
