import { describe, expect, it } from 'vitest';
import {
  getScheduleCronExpression,
  getScheduleDescription,
} from './scheduleTrigger';

describe('schedule trigger helpers', () => {
  it('builds weekly cron expressions with UTC time of day', () => {
    expect(
      getScheduleCronExpression({
        frequencyValue: 1,
        frequencyUnit: 'weeks',
        dayOfWeek: 'Sunday',
        hourOfDayUtc: 3,
        minuteOfHourUtc: 15,
      }),
    ).toBe('15 3 * * 0');
  });

  it('renders weekly schedule descriptions with UTC time of day', () => {
    expect(
      getScheduleDescription({
        frequencyValue: 1,
        frequencyUnit: 'weeks',
        dayOfWeek: 'Sunday',
        hourOfDayUtc: 3,
        minuteOfHourUtc: 0,
      }),
    ).toBe('every week on Sunday at 03:00 UTC');
  });
});
