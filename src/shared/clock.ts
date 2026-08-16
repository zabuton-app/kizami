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

/** One line of the clock display: a time, and the place it belongs to. */
export interface ClockRow {
  readonly key: 'home' | 'secondary'
  /** Null only when the home row is shown alone (2.3, 2.8). */
  readonly label: string | null
  readonly time: string
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
    return [{ key: 'home', label: null, time: homeTime }]
  }
  const parts = zonedClockParts(instant, input.secondary.zone)
  return [
    { key: 'home', label: input.homeLabel, time: homeTime },
    {
      key: 'secondary',
      label: input.secondary.label,
      // The same formatter as the home row, so one format choice covers both (2.4).
      time: formatClock(parts.hours, parts.minutes, parts.seconds, input.format)
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
