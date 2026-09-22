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

import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  computeNextRunAt,
  getScheduleConfig,
  scheduleSignature,
} from './computeNextRunAt';

// A Wednesday.
const FROM = new Date('2026-06-17T12:00:00.000Z');
const noJitter = () => 0;

describe('computeNextRunAt', () => {
  it('adds the interval for minute-based schedules (no jitter)', () => {
    const next = computeNextRunAt(
      { frequencyValue: 5, frequencyUnit: 'minutes' },
      { from: FROM, random: noJitter },
    );
    expect(next.toISOString()).toBe('2026-06-17T12:05:00.000Z');
  });

  it('adds the interval for hour-based schedules (no jitter)', () => {
    const next = computeNextRunAt(
      { frequencyValue: 2, frequencyUnit: 'hours' },
      { from: FROM, random: noJitter },
    );
    expect(next.toISOString()).toBe('2026-06-17T14:00:00.000Z');
  });

  it('keeps jitter within the capped bound and never before the slot', () => {
    const intervalMs = 30 * 60 * 1000;
    const next = computeNextRunAt(
      { frequencyValue: 30, frequencyUnit: 'minutes' },
      { from: FROM, random: () => 0.999999 },
    );
    const base = FROM.getTime() + intervalMs;
    const cap = Math.min(intervalMs * 0.1, 60_000);
    expect(next.getTime()).toBeGreaterThanOrEqual(base);
    expect(next.getTime()).toBeLessThanOrEqual(base + cap);
  });

  it('finds the next weekday slot for weekly-on-a-day schedules', () => {
    const next = computeNextRunAt(
      {
        frequencyValue: 1,
        frequencyUnit: 'weeks',
        dayOfWeek: 'Monday',
        hourOfDayUtc: 9,
        minuteOfHourUtc: 30,
      },
      { from: FROM },
    );
    const dt = DateTime.fromJSDate(next).toUTC();
    expect(dt.weekday).toBe(1); // Monday
    expect(dt.hour).toBe(9);
    expect(dt.minute).toBe(30);
    expect(next.getTime()).toBeGreaterThan(FROM.getTime());
    // The Monday after Wed 2026-06-17 is 2026-06-22.
    expect(dt.toISODate()).toBe('2026-06-22');
  });

  it('runs the same day when the weekly slot is still ahead', () => {
    // FROM is Wednesday 12:00; a Wednesday 18:00 slot is later today.
    const next = computeNextRunAt(
      {
        frequencyValue: 1,
        frequencyUnit: 'weeks',
        dayOfWeek: 'Wednesday',
        hourOfDayUtc: 18,
        minuteOfHourUtc: 0,
      },
      { from: FROM },
    );
    expect(next.toISOString()).toBe('2026-06-17T18:00:00.000Z');
  });

  it('pushes whole weeks for an every-N-weeks-on-a-day cadence', () => {
    const lastRunAt = new Date('2026-06-15T09:30:00.000Z'); // last Monday
    const next = computeNextRunAt(
      {
        frequencyValue: 2,
        frequencyUnit: 'weeks',
        dayOfWeek: 'Monday',
        hourOfDayUtc: 9,
        minuteOfHourUtc: 30,
      },
      { from: FROM, lastRunAt },
    );
    const dt = DateTime.fromJSDate(next).toUTC();
    expect(dt.weekday).toBe(1);
    // Must be >= lastRun + 2 weeks (2026-06-29), not the immediate next Monday.
    expect(next.getTime()).toBeGreaterThanOrEqual(
      new Date('2026-06-29T09:30:00.000Z').getTime(),
    );
    expect(dt.toISODate()).toBe('2026-06-29');
  });
});

describe('getScheduleConfig', () => {
  const scheduleNode = {
    id: 'trigger-1',
    type: 'trigger-schedule',
    position: { x: 0, y: 0 },
    data: {
      label: 'Schedule',
      config: { frequencyValue: 1, frequencyUnit: 'hours' },
    },
  };

  const base = {
    id: 'wf-1',
    name: 'wf',
    slug: 'wf',
    version: 1,
    workflowType: 'data-ingestion' as const,
    edges: [],
    createdBy: 'me',
    createdAt: '',
    updatedAt: '',
  };

  it('returns the config for an enabled scheduled workflow', () => {
    const config = getScheduleConfig({
      ...base,
      enabled: true,
      nodes: [scheduleNode],
    });
    expect(config).toEqual({ frequencyValue: 1, frequencyUnit: 'hours' });
  });

  it('returns undefined when disabled', () => {
    expect(
      getScheduleConfig({ ...base, enabled: false, nodes: [scheduleNode] }),
    ).toBeUndefined();
  });

  it('returns undefined with no schedule node', () => {
    expect(
      getScheduleConfig({ ...base, enabled: true, nodes: [] }),
    ).toBeUndefined();
  });

  it('returns undefined for a malformed config', () => {
    expect(
      getScheduleConfig({
        ...base,
        enabled: true,
        nodes: [
          {
            ...scheduleNode,
            data: { label: 'x', config: { frequencyUnit: 'hours' } },
          },
        ],
      }),
    ).toBeUndefined();
  });
});

describe('scheduleSignature', () => {
  it('changes when the cadence changes', () => {
    const hourly = scheduleSignature({
      frequencyValue: 1,
      frequencyUnit: 'hours',
    });
    const everyTwoMinutes = scheduleSignature({
      frequencyValue: 2,
      frequencyUnit: 'minutes',
    });
    expect(hourly).not.toBe(everyTwoMinutes);
  });

  it('is stable for equivalent configs', () => {
    expect(
      scheduleSignature({ frequencyValue: 1, frequencyUnit: 'hours' }),
    ).toBe(scheduleSignature({ frequencyValue: 1, frequencyUnit: 'hours' }));
  });

  it('distinguishes weekly slots that differ only by day or time', () => {
    const monday = scheduleSignature({
      frequencyValue: 1,
      frequencyUnit: 'weeks',
      dayOfWeek: 'Monday',
      hourOfDayUtc: 9,
      minuteOfHourUtc: 0,
    });
    const tuesday = scheduleSignature({
      frequencyValue: 1,
      frequencyUnit: 'weeks',
      dayOfWeek: 'Tuesday',
      hourOfDayUtc: 9,
      minuteOfHourUtc: 0,
    });
    const mondayLater = scheduleSignature({
      frequencyValue: 1,
      frequencyUnit: 'weeks',
      dayOfWeek: 'Monday',
      hourOfDayUtc: 17,
      minuteOfHourUtc: 30,
    });
    expect(new Set([monday, tuesday, mondayLater]).size).toBe(3);
  });
});
