import { DateTime } from 'luxon';

const DAYS_AGO_RE = /^days_ago\((\d+)\)$/;
const DAYS_FROM_NOW_RE = /^days_from_now\((\d+)\)$/;
const DATE_FORMAT_RE = /^date_format\('([^']+)'\)$/;

function evaluateExpression(expr: string): string | undefined {
  const parts = expr.split('|').map(p => p.trim());
  if (parts[0] !== 'now') {
    return undefined;
  }

  let dt = DateTime.now();
  let fmt: string | undefined;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const daysAgoMatch = DAYS_AGO_RE.exec(part);
    const daysFromNowMatch = DAYS_FROM_NOW_RE.exec(part);
    const dateFormatMatch = DATE_FORMAT_RE.exec(part);

    if (daysAgoMatch) {
      dt = dt.minus({ days: Number(daysAgoMatch[1]) });
    } else if (daysFromNowMatch) {
      dt = dt.plus({ days: Number(daysFromNowMatch[1]) });
    } else if (dateFormatMatch) {
      fmt = dateFormatMatch[1];
    } else {
      return undefined;
    }
  }

  return fmt ? dt.toFormat(fmt) : (dt.toISODate() ?? '');
}

export function renderTemplate(template: string): string {
  return template.replace(/\{\{(.+?)\}\}/g, (match, inner: string) => {
    const result = evaluateExpression(inner.trim());
    return result !== undefined ? result : match;
  });
}
