import type { MessageKey } from './i18n'
import type { ClockFormat, Language } from './types'

/** Length of a civil day in milliseconds. */
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

/** Milliseconds elapsed since local midnight; always in [0, DAY_MS). */
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
