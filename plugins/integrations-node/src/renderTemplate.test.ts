import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { renderTemplate } from './renderTemplate';

describe('renderTemplate', () => {
  it('passes plain path through unchanged', () => {
    const result = renderTemplate('/api/v1/users');
    expect(result).toBe('/api/v1/users');
  });

  it("renders {{ now }} to today's date", () => {
    const today = DateTime.now().toISODate();
    const result = renderTemplate('/api/events?date={{ now }}');
    expect(result).toBe(`/api/events?date=${today}`);
  });

  it('renders days_ago filter', () => {
    const expected = DateTime.now().minus({ days: 365 }).toISODate();
    const result = renderTemplate('/api?since={{ now | days_ago(365) }}');
    expect(result).toBe(`/api?since=${expected}`);
  });

  it('renders days_from_now filter', () => {
    const expected = DateTime.now().plus({ days: 30 }).toISODate();
    const result = renderTemplate('/api?until={{ now | days_from_now(30) }}');
    expect(result).toBe(`/api?until=${expected}`);
  });

  it('renders date_format filter', () => {
    const expected = DateTime.now().toFormat('yyyy/MM/dd');
    const result = renderTemplate(
      "/api?date={{ now | date_format('yyyy/MM/dd') }}",
    );
    expect(result).toBe(`/api?date=${expected}`);
  });

  it('chains days_ago with date_format', () => {
    const expected = DateTime.now().minus({ days: 7 }).toFormat('MM-dd-yyyy');
    const result = renderTemplate(
      "/api?since={{ now | days_ago(7) | date_format('MM-dd-yyyy') }}",
    );
    expect(result).toBe(`/api?since=${expected}`);
  });

  it('renders combined range expression', () => {
    const start = DateTime.now().minus({ days: 365 }).toISODate();
    const end = DateTime.now().toISODate();
    const result = renderTemplate(
      '/search?range={{ now | days_ago(365) }}..{{ now }}',
    );
    expect(result).toBe(`/search?range=${start}..${end}`);
  });
});
