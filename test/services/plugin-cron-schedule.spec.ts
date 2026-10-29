import { cronDue } from '../../src/plugins/cron-schedule';

const at = (iso: string) => new Date(iso);

describe('cronDue (five-field cron in UTC)', () => {
  it('matches every minute, fixed times, ranges, steps and lists', () => {
    expect(cronDue('* * * * *', at('2026-10-29T13:37:00Z'))).toBe(true);
    expect(cronDue('37 13 * * *', at('2026-10-29T13:37:45Z'))).toBe(true);
    expect(cronDue('38 13 * * *', at('2026-10-29T13:37:00Z'))).toBe(false);
    expect(cronDue('*/15 * * * *', at('2026-10-29T13:45:00Z'))).toBe(true);
    expect(cronDue('*/15 * * * *', at('2026-10-29T13:46:00Z'))).toBe(false);
    expect(cronDue('0-10/5 9-17 * * *', at('2026-10-29T09:10:00Z'))).toBe(true);
    expect(cronDue('0-10/5 9-17 * * *', at('2026-10-29T18:10:00Z'))).toBe(false);
    expect(cronDue('1,2,3 * * * *', at('2026-10-29T13:02:00Z'))).toBe(true);
  });

  it('reads month and weekday names, 7 as Sunday, and the either-day rule', () => {
    // 2026-10-29 is a Thursday; 2026-11-01 a Sunday.
    expect(cronDue('0 9 * * thu', at('2026-10-29T09:00:00Z'))).toBe(true);
    expect(cronDue('0 9 * * MON-WED', at('2026-10-29T09:00:00Z'))).toBe(false);
    expect(cronDue('0 0 * * 7', at('2026-11-01T00:00:00Z'))).toBe(true);
    expect(cronDue('0 0 1 nov *', at('2026-11-01T00:00:00Z'))).toBe(true);
    // Both day fields restricted: either one matching is enough.
    expect(cronDue('0 0 13 * 4', at('2026-10-29T00:00:00Z'))).toBe(true);
    expect(cronDue('0 0 13 * 5', at('2026-10-29T00:00:00Z'))).toBe(false);
    // Only day-of-month restricted: the weekday does not matter.
    expect(cronDue('0 0 29 * *', at('2026-10-29T00:00:00Z'))).toBe(true);
  });

  it('accepts the @ shorthands', () => {
    expect(cronDue('@hourly', at('2026-10-29T13:00:00Z'))).toBe(true);
    expect(cronDue('@daily', at('2026-10-29T13:00:00Z'))).toBe(false);
    expect(cronDue('@weekly', at('2026-11-01T00:00:00Z'))).toBe(true);
  });

  it('refuses expressions it cannot read', () => {
    for (const bad of [
      '',
      '* * * *',
      '61 * * * *',
      '* * * * * *',
      'a b c d e',
      '*/0 * * * *',
      '5-1 * * * *',
    ]) {
      expect(() => cronDue(bad, at('2026-10-29T13:37:00Z'))).toThrow();
    }
  });
});
