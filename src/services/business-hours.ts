/*
 * Business hours calculator, as escalated-laravel's BusinessHoursCalculator.
 *
 * Opening hours are wall-clock times in the schedule's time zone (UTC when the
 * zone is unknown), but time is counted in real elapsed minutes, so a window
 * on a daylight-saving change day is an hour shorter or longer than its
 * wall-clock span, and an opening time skipped by spring-forward opens at the
 * change. A window belongs to the local date it opens on: a holiday (one-off,
 * or recurring every year on its month and day) on that date closes it,
 * overnight part included. `24:00` is the next midnight; an end before the
 * start is an overnight window; an equal start and end is closed, as is a day
 * with `enabled: false`. A schedule with no open day counts calendar time, so
 * a policy never loses its deadline.
 */

export type DayHours = { start?: string | null; end?: string | null; enabled?: boolean } | null;

export interface BusinessHoursSchedule {
  timezone?: string | null;
  schedule?: Record<string, DayHours | undefined> | null;
  holidays?: Array<{ date: string | Date; isRecurring?: boolean | null }> | null;
}

type CivilDate = { y: number; m: number; d: number };

const MINUTE = 60_000;
const DAY = 86_400_000;
/** A schedule whose windows are all closed by holidays for ten years has no hours. */
const MAX_SCAN_DAYS = 3660;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** The instant `minutes` of business time after `from`. */
export function addBusinessMinutes(
  from: Date,
  minutes: number,
  schedule: BusinessHoursSchedule,
): Date {
  let remaining = Math.round(minutes * MINUTE);
  if (!(remaining > 0)) return new Date(from.getTime());

  const calendar = new Date(from.getTime() + remaining);
  if (!hasOpenDay(schedule)) return calendar;

  const zone = zoneOf(schedule);
  let cursor = from.getTime();
  // Start a day early: an overnight window opened yesterday may still be open.
  let day = addDays(localDate(cursor, zone), -1);

  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    const win = windowOn(day, schedule, zone);
    if (win && win.end > cursor) {
      const start = Math.max(win.start, cursor);
      const available = win.end - start;
      if (remaining <= available) return new Date(start + remaining);
      remaining -= available;
      cursor = win.end;
    }
    day = addDays(day, 1);
  }

  return calendar;
}

/** Whether `at` falls inside one of the schedule's opening windows. */
export function isWithinBusinessHours(at: Date, schedule: BusinessHoursSchedule): boolean {
  const zone = zoneOf(schedule);
  const instant = at.getTime();
  const today = localDate(instant, zone);
  for (const day of [addDays(today, -1), today]) {
    const win = windowOn(day, schedule, zone);
    if (win && instant >= win.start && instant < win.end) return true;
  }
  return false;
}

/** Whether a time zone name is one the calculator can use. */
export function isValidTimezone(name: unknown): name is string {
  if (typeof name !== 'string' || name === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether an SLA policy counts business hours: it has its own schedule (as
 * before `businessHoursOnly` existed), or it is flagged and takes one from the
 * ticket's department or the default.
 */
export function countsBusinessHours(policy: {
  businessHoursOnly?: boolean | null;
  businessScheduleId?: number | null;
}): boolean {
  return policy.businessHoursOnly === true || policy.businessScheduleId != null;
}

// ---- Internals ----

function zoneOf(schedule: BusinessHoursSchedule): string {
  return isValidTimezone(schedule.timezone) ? schedule.timezone : 'UTC';
}

function hasOpenDay(schedule: BusinessHoursSchedule): boolean {
  return WEEKDAYS.some((key) => bounds(schedule.schedule?.[key]) !== null);
}

function windowOn(
  day: CivilDate,
  schedule: BusinessHoursSchedule,
  zone: string,
): { start: number; end: number } | null {
  const weekday = new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
  const hours = bounds(schedule.schedule?.[WEEKDAYS[weekday]]);
  if (!hours || isHoliday(day, schedule)) return null;

  const start = wallClock(day, hours.start, zone);
  const end = wallClock(hours.end <= hours.start ? addDays(day, 1) : day, hours.end, zone);
  return end > start ? { start, end } : null;
}

function isHoliday(day: CivilDate, schedule: BusinessHoursSchedule): boolean {
  const date = isoDate(day);
  return (schedule.holidays ?? []).some((holiday) => {
    const raw = holiday?.date;
    const value =
      raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    return holiday.isRecurring ? value.slice(5) === date.slice(5) : value === date;
  });
}

/** A day's start and end in minutes after midnight, or null when closed. */
function bounds(hours: DayHours | undefined): { start: number; end: number } | null {
  if (!hours || typeof hours !== 'object' || hours.enabled === false) return null;
  const start = clockMinutes(hours.start);
  const end = clockMinutes(hours.end);
  if (start === null || end === null || start >= 1440 || start === end) return null;
  return { start, end };
}

/** Parses "HH:MM", 00:00 to 24:00. */
function clockMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

/**
 * The instant the clock in `zone` reads `minutes` past midnight on the local
 * date `day`. 1440 is the next midnight. Of two instants with that reading
 * (fall-back), the earlier; a reading skipped by spring-forward resolves to
 * the moment the clocks go forward.
 */
function wallClock(day: CivilDate, minutes: number, zone: string): number {
  const date = minutes >= 1440 ? addDays(day, 1) : day;
  const offset = minutes % 1440;
  const wanted = Date.UTC(date.y, date.m - 1, date.d, Math.floor(offset / 60), offset % 60);

  const candidates = [
    ...new Set([wanted - offsetAt(wanted - DAY, zone), wanted - offsetAt(wanted + DAY, zone)]),
  ];
  const exact = candidates.filter((t) => wallMillis(t, zone) === wanted);
  if (exact.length) return Math.min(...exact);

  // A gap: the change lies between the two readings. Find the first minute
  // whose wall time is not before the one asked for.
  let low = Math.min(...candidates);
  let high = Math.max(...candidates);
  while (high - low > MINUTE) {
    const mid = low + Math.floor((high - low) / 2 / MINUTE) * MINUTE;
    if (wallMillis(mid, zone) >= wanted) high = mid;
    else low = mid;
  }
  return wallMillis(low, zone) >= wanted ? low : high;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, format);
  }
  return format;
}

/** The wall-clock reading in `zone` at `instant`, as if it were UTC milliseconds. */
function wallMillis(instant: number, zone: string): number {
  const parts: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(instant))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute,
    parts.second,
  );
}

function offsetAt(instant: number, zone: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  return wallMillis(whole, zone) - whole;
}

function localDate(instant: number, zone: string): CivilDate {
  const wall = new Date(wallMillis(instant, zone));
  return { y: wall.getUTCFullYear(), m: wall.getUTCMonth() + 1, d: wall.getUTCDate() };
}

function addDays(day: CivilDate, days: number): CivilDate {
  const next = new Date(Date.UTC(day.y, day.m - 1, day.d + days));
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}

function isoDate(day: CivilDate): string {
  return `${String(day.y).padStart(4, '0')}-${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`;
}
