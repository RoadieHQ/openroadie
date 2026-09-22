import React, { useMemo, useRef } from 'react';
import { OutlinedNumberInput } from '@roadiehq/ui/outlined-number-input';
import { OutlinedSelect } from '@roadiehq/ui/outlined-select';
import { SelectItem } from '@roadiehq/ui/select';

type FrequencyUnit = 'minutes' | 'hours' | 'days' | 'weeks';

const DAYS_OF_WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

const getRandomDay = (): DayOfWeek => {
  const weekendDays: DayOfWeek[] = ['Saturday', 'Sunday'];
  return weekendDays[Math.floor(Math.random() * weekendDays.length)];
};

interface ScheduleTriggerConfigState {
  frequencyValue?: number;
  frequencyUnit?: FrequencyUnit;
  dayOfWeek?: DayOfWeek;
}

export interface ScheduleTriggerConfigProps {
  config: ScheduleTriggerConfigState;
  onChange: (key: string, value: unknown) => void;
  nextRunAt?: string;
  readOnly?: boolean;
}

export function ScheduleTriggerConfig({
  config,
  onChange,
  nextRunAt,
  readOnly = false,
}: ScheduleTriggerConfigProps) {
  const randomDayRef = useRef<DayOfWeek>(getRandomDay());
  const frequencyValue = config.frequencyValue ?? 1;
  const frequencyUnit = config.frequencyUnit ?? 'hours';
  const dayOfWeek = config.dayOfWeek ?? randomDayRef.current;

  const scheduleDescription = useMemo(() => {
    const val = frequencyValue;
    const unit = frequencyUnit;
    if (unit === 'weeks') {
      if (val === 1) {
        return `This workflow will run every week on ${dayOfWeek}`;
      }
      return `This workflow will run every ${val} weeks on ${dayOfWeek}`;
    }
    if (val === 1) {
      const singular = unit.slice(0, -1);
      return `This workflow will run every ${singular}`;
    }
    return `This workflow will run every ${val} ${unit}`;
  }, [frequencyValue, frequencyUnit, dayOfWeek]);

  const nextRunDescription = useMemo(() => {
    if (!nextRunAt) {
      return null;
    }
    const date = new Date(nextRunAt);
    const formatted = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
    return `Next run: ${formatted}`;
  }, [nextRunAt]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h4 className="mb-2 text-sm font-medium">Frequency</h4>
        <div className="flex gap-2">
          <OutlinedNumberInput
            label="Value"
            value={String(frequencyValue)}
            disabled={readOnly}
            onChange={val => {
              const parsed = parseInt(val, 10);
              onChange('frequencyValue', parsed > 0 ? parsed : 1);
            }}
            min={1}
            className="w-[100px]"
            data-testid="schedule-frequency-value"
          />
          <OutlinedSelect
            label="Unit"
            value={frequencyUnit}
            onValueChange={newUnit => {
              onChange('frequencyUnit', newUnit as FrequencyUnit);
              if (newUnit === 'weeks' && !config.dayOfWeek) {
                onChange('dayOfWeek', randomDayRef.current);
              }
            }}
            className="w-[140px]"
            data-testid="schedule-frequency-unit"
          >
            <SelectItem value="minutes">Minutes</SelectItem>
            <SelectItem value="hours">Hours</SelectItem>
            <SelectItem value="days">Days</SelectItem>
            <SelectItem value="weeks">Weeks</SelectItem>
          </OutlinedSelect>
        </div>
      </div>

      {frequencyUnit === 'weeks' && (
        <div>
          <h4 className="mb-2 text-sm font-medium">Day of Week</h4>
          <OutlinedSelect
            label="Day"
            value={dayOfWeek}
            onValueChange={val => onChange('dayOfWeek', val as DayOfWeek)}
            className="w-full"
            data-testid="schedule-day-of-week"
          >
            {DAYS_OF_WEEK.map(day => (
              <SelectItem key={day} value={day}>
                {day}
              </SelectItem>
            ))}
          </OutlinedSelect>
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {nextRunDescription || scheduleDescription}
      </p>
    </div>
  );
}
