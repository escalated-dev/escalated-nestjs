import {
  addBusinessMinutes,
  BusinessHoursSchedule,
  DayHours,
  isWithinBusinessHours,
} from '../../src/services/business-hours';

/*
 * Same cases as escalated-laravel's BusinessHoursCalculatorTest. Hours are
 * wall-clock times in the schedule's zone, counted in real elapsed time.
 * 2026-10-23 is a Friday; 2026-10-26 a Monday.
 */

const closed = { start: '', end: '' };

function weekdays(start = '09:00', end = '17:00'): Record<string, DayHours> {
  const hours = { start, end };
  return {
    monday: hours,
    tuesday: hours,
    wednesday: hours,
    thursday: hours,
    friday: hours,
    saturday: closed,
    sunday: closed,
  };
}

function everyDay(start: string, end: string): Record<string, DayHours> {
  return Object.fromEntries(
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [
      d,
      { start, end },
    ]),
  );
}

function schedule(
  days: Record<string, DayHours>,
  timezone = 'UTC',
  holidays: BusinessHoursSchedule['holidays'] = [],
): BusinessHoursSchedule {
  return { timezone, schedule: days, holidays };
}

/** Adds hours from a UTC wall time and answers in UTC, `YYYY-MM-DD HH:mm`. */
function add(from: string, hours: number, s: BusinessHoursSchedule): string {
  const due = addBusinessMinutes(new Date(`${from.replace(' ', 'T')}:00Z`), hours * 60, s);
  return due.toISOString().slice(0, 16).replace('T', ' ');
}

const at = (value: string) => new Date(`${value.replace(' ', 'T')}:00Z`);

describe('business hours calculator', () => {
  it('adds hours inside one window', () => {
    expect(add('2026-10-26 10:00', 2, schedule(weekdays()))).toBe('2026-10-26 12:00');
  });

  it('skips the weekend', () => {
    expect(add('2026-10-23 16:00', 2, schedule(weekdays()))).toBe('2026-10-26 10:00');
  });

  it('starts at opening time when created before hours', () => {
    expect(add('2026-10-26 07:00', 1, schedule(weekdays()))).toBe('2026-10-26 10:00');
  });

  it('rolls over to the next open day when created after hours', () => {
    expect(add('2026-10-26 18:00', 1, schedule(weekdays()))).toBe('2026-10-27 10:00');
  });

  it('skips a one-off holiday', () => {
    const s = schedule(weekdays(), 'UTC', [{ date: '2026-10-27' }]);
    expect(add('2026-10-26 16:00', 2, s)).toBe('2026-10-28 10:00');
  });

  it('skips a recurring holiday in a later year', () => {
    const s = schedule(weekdays(), 'UTC', [{ date: '2020-12-25', isRecurring: true }]);
    expect(add('2026-12-24 16:00', 2, s)).toBe('2026-12-28 10:00');
  });

  it('does not treat a one-off holiday as recurring', () => {
    const s = schedule(weekdays(), 'UTC', [{ date: '2025-10-27' }]);
    expect(add('2026-10-26 16:00', 2, s)).toBe('2026-10-27 10:00');
  });

  it('counts an overnight window across midnight', () => {
    const s = schedule(everyDay('22:00', '06:00'));
    expect(add('2026-10-26 23:00', 2, s)).toBe('2026-10-27 01:00');
    // Monday 05:00 is still inside Sunday's window.
    expect(add('2026-10-26 05:00', 2, s)).toBe('2026-10-26 23:00');
  });

  it('closes the whole overnight window that opens on a holiday', () => {
    const s = schedule(everyDay('22:00', '06:00'), 'UTC', [{ date: '2026-10-27' }]);
    expect(add('2026-10-26 23:00', 8, s)).toBe('2026-10-28 23:00');
  });

  it('reads 24:00 as the next midnight', () => {
    expect(add('2026-10-26 23:00', 2, schedule(weekdays('09:00', '24:00')))).toBe(
      '2026-10-27 10:00',
    );
  });

  it('treats an equal start and end as closed', () => {
    const days = weekdays();
    days.monday = { start: '09:00', end: '09:00' };
    expect(add('2026-10-26 08:00', 1, schedule(days))).toBe('2026-10-27 10:00');
  });

  it('reads hours in the schedule time zone', () => {
    expect(add('2026-10-26 12:00', 1, schedule(weekdays(), 'America/New_York'))).toBe(
      '2026-10-26 14:00',
    );
  });

  it('matches holidays on the local date', () => {
    const s = schedule(weekdays('08:00', '10:00'), 'Asia/Tokyo', [{ date: '2026-10-26' }]);
    expect(add('2026-10-25 22:00', 1, s)).toBe('2026-10-27 00:00');
  });

  it('counts real time across a spring-forward change', () => {
    const s = schedule({ sunday: { start: '01:00', end: '05:00' } }, 'America/New_York');
    expect(add('2026-03-08 06:00', 3, s)).toBe('2026-03-08 09:00');
    expect(add('2026-03-08 06:00', 4, s)).toBe('2026-03-15 06:00');
  });

  it('opens at the change when the opening time is skipped by spring-forward', () => {
    const s = schedule({ sunday: { start: '02:30', end: '05:00' } }, 'America/New_York');
    expect(add('2026-03-08 05:00', 1, s)).toBe('2026-03-08 08:00');
  });

  it('counts real time across a fall-back change', () => {
    const s = schedule({ sunday: { start: '00:00', end: '04:00' } }, 'America/New_York');
    expect(add('2026-11-01 04:00', 5, s)).toBe('2026-11-01 09:00');
  });

  it('falls back to calendar time when no day is open', () => {
    expect(add('2026-10-24 10:00', 5, schedule({ monday: closed }))).toBe('2026-10-24 15:00');
  });

  it('uses UTC for an unknown time zone', () => {
    expect(add('2026-10-26 10:00', 2, schedule(weekdays(), 'Mars/Olympus_Mons'))).toBe(
      '2026-10-26 12:00',
    );
  });

  it('honours the enabled flag of schedules saved with one', () => {
    const days = weekdays();
    days.monday = { start: '09:00', end: '17:00', enabled: false };
    days.tuesday = { start: '09:00', end: '17:00', enabled: true };
    expect(add('2026-10-26 08:00', 1, schedule(days))).toBe('2026-10-27 10:00');
  });

  it('handles fractional hours and zero', () => {
    expect(add('2026-10-26 16:45', 0.5, schedule(weekdays()))).toBe('2026-10-27 09:15');
    expect(add('2026-10-24 10:00', 0, schedule(weekdays()))).toBe('2026-10-24 10:00');
  });

  it('tells whether an instant is within business hours', () => {
    const office = schedule(weekdays(), 'UTC', [{ date: '2026-10-27' }]);
    const overnight = schedule(everyDay('22:00', '06:00'));
    expect(isWithinBusinessHours(at('2026-10-26 10:00'), office)).toBe(true);
    expect(isWithinBusinessHours(at('2026-10-26 17:00'), office)).toBe(false);
    expect(isWithinBusinessHours(at('2026-10-24 10:00'), office)).toBe(false);
    expect(isWithinBusinessHours(at('2026-10-27 10:00'), office)).toBe(false);
    expect(isWithinBusinessHours(at('2026-10-27 01:00'), overnight)).toBe(true);
    expect(isWithinBusinessHours(at('2026-10-27 12:00'), overnight)).toBe(false);
  });
});
