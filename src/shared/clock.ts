import type { ClockFormat } from './types'

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
