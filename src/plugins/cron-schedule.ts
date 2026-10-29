/**
 * Five-field cron expressions (`minute hour day-of-month month day-of-week`),
 * as the plugin SDK's `cron` keys are written, evaluated in UTC. Supports `*`,
 * numbers, `a-b` ranges, `/step`, comma lists, month and weekday names, 7 as
 * Sunday, and the `@hourly`-style shorthands. When both day fields are
 * restricted, either one matching is enough (as cron does).
 */

const SHORTHANDS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface Field {
  min: number;
  max: number;
  names?: string[];
  /** The first name's number (months start at 1). */
  base?: number;
}

const FIELDS: Field[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: MONTHS, base: 1 },
  { min: 0, max: 7, names: DAYS, base: 0 },
];

function value(token: string, field: Field, expression: string): number {
  const name = field.names?.indexOf(token.toLowerCase()) ?? -1;
  if (name >= 0) return name + (field.base ?? 0);
  if (!/^\d+$/.test(token)) throw new Error(`Invalid cron expression "${expression}"`);
  const number = Number(token);
  if (number < field.min || number > field.max) {
    throw new Error(`Invalid cron expression "${expression}"`);
  }
  return number;
}

/** The values one field allows, and whether it was `*` (unrestricted). */
function parseField(
  text: string,
  field: Field,
  expression: string,
): { values: Set<number>; any: boolean } {
  const values = new Set<number>();
  let any = false;
  for (const part of text.split(',')) {
    const [range, stepText] = part.split('/');
    if (part.split('/').length > 2) throw new Error(`Invalid cron expression "${expression}"`);
    const step = stepText === undefined ? 1 : Number(stepText);
    if (
      !Number.isInteger(step) ||
      step < 1 ||
      (stepText !== undefined && !/^\d+$/.test(stepText))
    ) {
      throw new Error(`Invalid cron expression "${expression}"`);
    }
    let from: number;
    let to: number;
    if (range === '*') {
      from = field.min;
      to = field.max;
      if (stepText === undefined) any = true;
    } else if (range.includes('-')) {
      const [a, b, ...rest] = range.split('-');
      if (rest.length) throw new Error(`Invalid cron expression "${expression}"`);
      from = value(a, field, expression);
      to = value(b, field, expression);
      if (from > to) throw new Error(`Invalid cron expression "${expression}"`);
    } else {
      from = value(range, field, expression);
      to = stepText === undefined ? from : field.max;
    }
    for (let n = from; n <= to; n += step) values.add(n);
  }
  return { values, any };
}

/** Whether `expression` is due in the minute containing `at` (UTC). Throws when unreadable. */
export function cronDue(expression: string, at: Date): boolean {
  const text = SHORTHANDS[expression.trim().toLowerCase()] ?? expression.trim();
  const parts = text.split(/\s+/);
  if (parts.length !== 5 || parts.some((part) => part === '')) {
    throw new Error(`Invalid cron expression "${expression}"`);
  }
  const [minute, hour, dom, month, dow] = parts.map((part, i) =>
    parseField(part, FIELDS[i], expression),
  );
  if (dow.values.has(7)) dow.values.add(0);

  if (!minute.values.has(at.getUTCMinutes())) return false;
  if (!hour.values.has(at.getUTCHours())) return false;
  if (!month.values.has(at.getUTCMonth() + 1)) return false;
  const domMatch = dom.values.has(at.getUTCDate());
  const dowMatch = dow.values.has(at.getUTCDay());
  if (!dom.any && !dow.any) return domMatch || dowMatch;
  return domMatch && dowMatch;
}
