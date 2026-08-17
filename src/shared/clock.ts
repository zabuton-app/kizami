import type { MessageKey } from './i18n'
import type { ClockFormat, Language } from './types'

/** Length of a 24-hour day in milliseconds (fixed; DST shifts are ignored). */
export const DAY_MS = 86_400_000

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Format a time of day for the clock display: 24-hour, zero-padded,
 * with or without seconds. Components are taken as numbers (not a Date)
 * so callers pass local wall-clock parts and tests stay timezone-free.
 */
export function formatClock(
  hours: number,
  minutes: number,
  seconds: number,
  format: ClockFormat
): string {
  const base = `${pad2(hours)}:${pad2(minutes)}`
  return format === 'hhmmss' ? `${base}:${pad2(seconds)}` : base
}

/**
 * Milliseconds elapsed since local midnight. Assumes the components come
 * from a local Date's getters; the result is not clamped to [0, DAY_MS).
 */
export function msIntoDay(hours: number, minutes: number, seconds: number, ms: number): number {
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + ms
}

/** Weekday dictionary keys indexed by Date#getDay(), which counts from Sunday. */
export const WEEKDAY_KEYS = [
  'weekday.sun',
  'weekday.mon',
  'weekday.tue',
  'weekday.wed',
  'weekday.thu',
  'weekday.fri',
  'weekday.sat'
] as const satisfies readonly MessageKey[]

/**
 * Format a calendar date for the clock display, in the language's customary
 * order: `8/13（水）` for ja, `Wed 8/13` for en. `month` is 1-based and the
 * weekday label comes from the i18n dictionary, so this stays a pure string
 * builder.
 */
export function formatClockDate(
  month: number,
  day: number,
  weekdayLabel: string,
  language: Language
): string {
  return language === 'ja'
    ? `${month}/${day}（${weekdayLabel}）`
    : `${weekdayLabel} ${month}/${day}`
}

/** Furthest the displayed time may be shifted from now, in hours either way. */
export const SHIFT_HOURS_LIMIT = 24

/** Idle period after the last shift input before the display returns to now. */
export const SHIFT_RESET_MS = 10_000

const HOUR_MS = 3_600_000

/** A time of day as numbers, in the shape `formatClock` already takes. */
export interface ClockParts {
  readonly hours: number
  readonly minutes: number
  readonly seconds: number
}

/**
 * One formatter per zone. Building an `Intl.DateTimeFormat` is the expensive
 * part of the conversion and the clock re-derives every row once a second, so
 * formatters are built on first use and kept for the life of the process.
 * There is at most one comparison zone at a time, so the map stays tiny.
 */
const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

function zoneFormatter(zone: string): Intl.DateTimeFormat {
  const cached = zoneFormatters.get(zone)
  if (cached !== undefined) {
    return cached
  }
  // `h23` is deliberate: other hour cycles report midnight as 24, which would
  // render as `24:07` for an hour every night. `en-US` pins latin digits so
  // the parts parse back to numbers.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  zoneFormatters.set(zone, formatter)
  return formatter
}

function partValue(parts: readonly Intl.DateTimeFormatPart[], type: string): number {
  const part = parts.find((candidate) => candidate.type === type)
  return part === undefined ? 0 : Number(part.value)
}

/**
 * A second formatter per zone, this one carrying the date as well. Kept apart
 * from the time-only one above because the clock reads that one every second
 * and has no use for the date; only the offset does, and only because a date
 * is what tells a zone a day away from one in step with home.
 */
const zoneDateFormatters = new Map<string, Intl.DateTimeFormat>()

function zoneDateFormatter(zone: string): Intl.DateTimeFormat {
  const cached = zoneDateFormatters.get(zone)
  if (cached !== undefined) {
    return cached
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  zoneDateFormatters.set(zone, formatter)
  return formatter
}

/**
 * The wall-clock time an instant shows in `zone`. The offset actually in
 * effect at that instant is applied, so daylight-saving transitions are
 * resolved by the platform's timezone data rather than by arithmetic here.
 * `zone` is expected to be a resolvable IANA id; the curated catalog is the
 * only source of one.
 */
export function zonedClockParts(instant: Date, zone: string): ClockParts {
  const parts = zoneFormatter(zone).formatToParts(instant)
  return {
    hours: partValue(parts, 'hour'),
    minutes: partValue(parts, 'minute'),
    seconds: partValue(parts, 'second')
  }
}

/**
 * The instant the clock should display: `now` moved by whole hours. Shifting
 * the instant rather than the rendered hour is what keeps every row on the
 * same moment, and leaves the real minutes and seconds ticking on the display.
 */
export function shiftInstant(now: Date, shiftHours: number): Date {
  return new Date(now.getTime() + shiftHours * HOUR_MS)
}

/**
 * Positions a shift cycles through in one direction: every hour out to the
 * limit, and then zero. Zero sits one step past the far end, which is what
 * makes scrolling wrap instead of stop.
 */
const SHIFT_CYCLE = SHIFT_HOURS_LIMIT + 1

/**
 * Confine a shift to whole hours within a day either side of now, wrapping
 * back to zero one step past either end rather than stopping there — a user
 * who keeps scrolling one way should keep getting a response instead of
 * hitting a wall. Truncating a stray fraction can only ever shrink the shift.
 *
 * `%` keeps the sign of its left operand, so a shift running forward wraps
 * `+25` to zero and a shift running backward wraps `-25` to zero, each staying
 * on its own side rather than jumping across to the other end.
 */
export function wrapShiftHours(value: number): number {
  if (!Number.isFinite(value)) {
    // There is no position a day away from an unrepresentable one, so read a
    // broken input as "not shifted" rather than inventing an end to land on.
    return 0
  }
  const whole = Math.trunc(value) % SHIFT_CYCLE
  // `Math.trunc` and `%` both yield -0 for a small negative; collapse it so an
  // unshifted clock has a single representation.
  return whole === 0 ? 0 : whole
}

/**
 * Minutes a zone runs ahead of UTC at an instant. Built from the zone's own
 * calendar reading rather than parsed out of a formatted offset string: the
 * date has to come along, or a zone a day away from UTC would be
 * indistinguishable from one that matches it.
 */
function zoneUtcOffsetMinutes(instant: Date, zone: string): number {
  const parts = zoneDateFormatter(zone).formatToParts(instant)
  const asUtc = Date.UTC(
    partValue(parts, 'year'),
    partValue(parts, 'month') - 1,
    partValue(parts, 'day'),
    partValue(parts, 'hour'),
    partValue(parts, 'minute'),
    partValue(parts, 'second')
  )
  // The formatter has no milliseconds, so drop them from the instant too or
  // every offset would come out a fraction of a minute off.
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000
}

/**
 * Minutes the comparison zone runs ahead of (positive) or behind (negative)
 * home at an instant — what the comparison row shows beside its time.
 *
 * Both sides are resolved to their offset from UTC and subtracted, rather than
 * taking the difference of the two wall clocks. A wall-clock subtraction wraps
 * at a day, so it cannot tell a zone exactly 24 hours away from one in step
 * with home, and both are reachable: a machine at +14 with the catalog's -10
 * is a full day apart.
 */
export function zoneOffsetMinutes(instant: Date, zone: string): number {
  const home = -instant.getTimezoneOffset()
  return zoneUtcOffsetMinutes(instant, zone) - home
}

/**
 * A zone offset as the comparison row shows it: `-9:00`, `+3:45`, and `0:00`
 * for a zone in step with home. The hours are not padded — this reads as a
 * difference, not as a time — while the minutes are, so `-9:00` cannot be
 * misread as nine and a bit.
 */
export function formatZoneOffset(offsetMinutes: number): string {
  const sign = offsetMinutes > 0 ? '+' : offsetMinutes < 0 ? '-' : ''
  const total = Math.abs(offsetMinutes)
  return `${sign}${Math.floor(total / 60)}:${pad2(total % 60)}`
}

/** One line of the clock display: a time, and the place it belongs to. */
export interface ClockRow {
  readonly key: 'home' | 'secondary'
  /** Null only when the home row is shown alone (2.3, 2.8). */
  readonly label: string | null
  readonly time: string
  /** How far this row is from home; null on the home row, which is the datum. */
  readonly offset: string | null
}

export interface ClockRowsInput {
  readonly now: Date
  readonly shiftHours: number
  readonly format: ClockFormat
  readonly homeLabel: string
  readonly secondary: { readonly zone: string; readonly label: string } | null
}

/**
 * The rows the clock shows for one instant and one shift. Both rows are derived
 * from the same shifted instant, which is what makes the gap between them the
 * zones' real offset at that moment (3.2). The home row reads the local `Date`
 * getters, so a change to the operating system's zone is picked up on the next
 * tick without this module knowing about it (2.7); only the comparison row goes
 * through `Intl` (2.5). `now` comes from the caller, so nothing here reads a
 * clock of its own and every value is re-derived per tick (6.4).
 */
export function buildClockRows(input: ClockRowsInput): readonly ClockRow[] {
  const instant = shiftInstant(input.now, input.shiftHours)
  const homeTime = formatClock(
    instant.getHours(),
    instant.getMinutes(),
    instant.getSeconds(),
    input.format
  )
  if (input.secondary === null) {
    // Alone, the home row has nothing to be told apart from, so it stays
    // unlabeled and 007's single-row display is unchanged (2.3, 2.8).
    return [{ key: 'home', label: null, time: homeTime, offset: null }]
  }
  const parts = zonedClockParts(instant, input.secondary.zone)
  return [
    { key: 'home', label: input.homeLabel, time: homeTime, offset: null },
    {
      key: 'secondary',
      label: input.secondary.label,
      // The same formatter as the home row, so one format choice covers both (2.4).
      time: formatClock(parts.hours, parts.minutes, parts.seconds, input.format),
      // Read at the displayed instant, so it follows the shift and either
      // zone's daylight saving rather than describing only now (2.5).
      offset: formatZoneOffset(zoneOffsetMinutes(instant, input.secondary.zone))
    }
  ]
}

/**
 * The shift indication, such as `+8h`. Empty when the clock is showing now,
 * where there is nothing to warn about. The hour unit is passed in, like
 * `formatClockDate`'s weekday label, keeping message lookup out of here.
 */
export function formatShiftLabel(shiftHours: number, hourUnit: string): string {
  if (shiftHours === 0) {
    return ''
  }
  const sign = shiftHours > 0 ? '+' : '-'
  return `${sign}${Math.abs(shiftHours)}${hourUnit}`
}
