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

import { DateTime } from 'luxon';
import {
  NODE_TYPES,
  WorkflowDefinition,
} from '@roadiehq/catalog-workflow-common';
import {
  ScheduleTriggerConfig,
  getScheduleFrequencyMs,
} from '../nodes/triggers/scheduleTrigger';

const DAY_TO_LUXON_WEEKDAY: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

const MAX_JITTER_MS = 60_000;
const JITTER_FRACTION = 0.1;

function clampHour(value: number | undefined): number {
  return Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 23
    ? (value as number)
    : 0;
}

function clampMinute(value: number | undefined): number {
  return Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= 59
    ? (value as number)
    : 0;
}

export interface ComputeNextRunAtOptions {
  from?: Date;
  lastRunAt?: Date | null;
  random?: () => number;
}

export function computeNextRunAt(
  config: ScheduleTriggerConfig,
  options?: ComputeNextRunAtOptions,
): Date {
  const from = DateTime.fromJSDate(options?.from ?? new Date()).toUTC();

  if (config.frequencyUnit === 'weeks' && config.dayOfWeek) {
    return nextWeeklySlot(config, from, options?.lastRunAt ?? null).toJSDate();
  }

  const intervalMs = getScheduleFrequencyMs(config);
  const random = options?.random ?? Math.random;
  const jitterCeiling = Math.min(intervalMs * JITTER_FRACTION, MAX_JITTER_MS);
  const jitterMs = Math.floor(random() * jitterCeiling);
  return from.plus({ milliseconds: intervalMs + jitterMs }).toJSDate();
}

function nextWeeklySlot(
  config: ScheduleTriggerConfig,
  from: DateTime,
  lastRunAt: Date | null,
): DateTime {
  const targetWeekday = DAY_TO_LUXON_WEEKDAY[`${config.dayOfWeek}`] ?? 1;
  const hour = clampHour(config.hourOfDayUtc);
  const minute = clampMinute(config.minuteOfHourUtc);

  let candidate = from.set({ hour, minute, second: 0, millisecond: 0 });
  const dayDiff = (targetWeekday - candidate.weekday + 7) % 7;
  candidate = candidate.plus({ days: dayDiff });
  if (candidate <= from) {
    candidate = candidate.plus({ weeks: 1 });
  }

  const weeks = config.frequencyValue;
  if (weeks > 1 && lastRunAt) {
    const earliest = DateTime.fromJSDate(lastRunAt).toUTC().plus({ weeks });
    while (candidate < earliest) {
      candidate = candidate.plus({ weeks: 1 });
    }
  }

  return candidate;
}

/**
 * A stable fingerprint of the cadence-affecting fields of a schedule trigger.
 */
export function scheduleSignature(config: ScheduleTriggerConfig): string {
  return [
    config.frequencyValue,
    config.frequencyUnit,
    config.dayOfWeek ?? '',
    config.hourOfDayUtc ?? '',
    config.minuteOfHourUtc ?? '',
  ].join('|');
}

export function getScheduleConfig(
  workflow: WorkflowDefinition,
): ScheduleTriggerConfig | undefined {
  if (!workflow.enabled) {
    return undefined;
  }
  const node = workflow.nodes.find(n => n.type === NODE_TYPES.TRIGGER_SCHEDULE);
  if (!node?.data?.config) {
    return undefined;
  }
  const config = node.data.config as ScheduleTriggerConfig;
  if (typeof config.frequencyValue !== 'number' || !config.frequencyUnit) {
    return undefined;
  }
  return config;
}
