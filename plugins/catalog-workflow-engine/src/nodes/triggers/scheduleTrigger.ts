/*
 * Copyright 2025 Larder Software Limited
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

import { RegisteredNodeType } from '../../engine';
import { NODE_TYPES } from '@roadiehq/catalog-workflow-common';

export type ScheduleFrequencyUnit = 'minutes' | 'hours' | 'days' | 'weeks';

export type DayOfWeek =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sunday';

export interface ScheduleTriggerConfig extends Record<string, unknown> {
  frequencyValue: number;
  frequencyUnit: ScheduleFrequencyUnit;
  dayOfWeek?: DayOfWeek;
  hourOfDayUtc?: number;
  minuteOfHourUtc?: number;
}

export function getScheduleFrequencyMs(config: ScheduleTriggerConfig): number {
  const { frequencyValue, frequencyUnit } = config;
  switch (frequencyUnit) {
    case 'minutes':
      return frequencyValue * 60 * 1000;
    case 'hours':
      return frequencyValue * 60 * 60 * 1000;
    case 'days':
      return frequencyValue * 24 * 60 * 60 * 1000;
    case 'weeks':
      return frequencyValue * 7 * 24 * 60 * 60 * 1000;
    default:
      return frequencyValue * 60 * 1000;
  }
}

function getCronDayOfWeek(day: DayOfWeek): number {
  const mapping: Record<DayOfWeek, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  return mapping[day];
}

function asUtcHour(value: number | undefined): number {
  if (
    value === undefined ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 23
  ) {
    return 0;
  }
  return value;
}

function asUtcMinute(value: number | undefined): number {
  if (
    value === undefined ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 59
  ) {
    return 0;
  }
  return value;
}

export function getScheduleCronExpression(
  config: ScheduleTriggerConfig,
): string | undefined {
  if (config.frequencyUnit !== 'weeks' || !config.dayOfWeek) {
    return undefined;
  }

  return `${asUtcMinute(config.minuteOfHourUtc)} ${asUtcHour(config.hourOfDayUtc)} * * ${getCronDayOfWeek(config.dayOfWeek)}`;
}

export function getScheduleDescription(config: ScheduleTriggerConfig): string {
  const unit =
    config.frequencyValue === 1
      ? config.frequencyUnit.replace(/s$/, '')
      : config.frequencyUnit;
  let scheduleDesc =
    config.frequencyValue === 1
      ? `every ${unit}`
      : `every ${config.frequencyValue} ${unit}`;
  if (config.frequencyUnit === 'weeks' && config.dayOfWeek) {
    scheduleDesc += ` on ${config.dayOfWeek}`;
    if (
      config.hourOfDayUtc !== undefined ||
      config.minuteOfHourUtc !== undefined
    ) {
      scheduleDesc += ` at ${String(asUtcHour(config.hourOfDayUtc)).padStart(2, '0')}:${String(asUtcMinute(config.minuteOfHourUtc)).padStart(2, '0')} UTC`;
    }
  }
  return scheduleDesc;
}

export const scheduleTriggerNode: RegisteredNodeType = {
  type: NODE_TYPES.TRIGGER_SCHEDULE,
  category: 'trigger',
  label: 'Schedule',
  description: 'Trigger workflow execution on a recurring schedule',
  icon: 'schedule',
  color: '#10b981',

  configSchema: {
    type: 'object',
    properties: {
      frequencyValue: {
        type: 'number',
        title: 'Frequency',
        description: 'How often to run the workflow',
        default: 1,
      },
      frequencyUnit: {
        type: 'string',
        title: 'Frequency Unit',
        enum: ['minutes', 'hours', 'days', 'weeks'],
        default: 'hours',
      },
      dayOfWeek: {
        type: 'string',
        title: 'Day of Week',
        enum: [
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
          'Sunday',
        ],
        description: 'Day of week for weekly schedules',
      },
      hourOfDayUtc: {
        type: 'number',
        title: 'Hour of Day (UTC)',
        minimum: 0,
        maximum: 23,
      },
      minuteOfHourUtc: {
        type: 'number',
        title: 'Minute of Hour (UTC)',
        minimum: 0,
        maximum: 59,
      },
    },
    required: ['frequencyValue', 'frequencyUnit'],
  },

  inputSchema: {},
  outputSchema: { type: 'any' },

  inputs: [],
  outputs: [{ id: 'default', label: 'Trigger', type: 'any' }],

  supportsDryRun: true,
};
