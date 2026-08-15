import { describe, expect, it } from 'vitest'
import {
  clampShiftHours,
  DAY_MS,
  formatClock,
  formatClockDate,
  formatShiftLabel,
  msIntoDay,
  SHIFT_HOURS_LIMIT,
  SHIFT_RESET_MS,
  shiftInstant,
  WEEKDAY_KEYS,
  zonedClockParts
} from '../../src/shared/clock'
import { filledBlocks } from '../../src/shared/timer-logic'

describe('formatClock', () => {
  it('formats hh:mm with zero padding', () => {
    expect(formatClock(9, 5, 7, 'hhmm')).toBe('09:05')
    expect(formatClock(0, 0, 0, 'hhmm')).toBe('00:00')
  })

  it('formats hh:mm:ss with zero padding', () => {
    expect(formatClock(9, 5, 7, 'hhmmss')).toBe('09:05:07')
    expect(formatClock(0, 0, 0, 'hhmmss')).toBe('00:00:00')
  })

  it('keeps 24-hour notation at the end of the day', () => {
    expect(formatClock(23, 59, 59, 'hhmm')).toBe('23:59')
    expect(formatClock(23, 59, 59, 'hhmmss')).toBe('23:59:59')
  })

  it('ignores the seconds component in hh:mm', () => {
    expect(formatClock(12, 30, 59, 'hhmm')).toBe('12:30')
  })
})

describe('formatClockDate', () => {
  it('formats ja as M/D（曜）', () => {
    expect(formatClockDate(8, 13, '水', 'ja')).toBe('8/13（水）')
    expect(formatClockDate(12, 31, '木', 'ja')).toBe('12/31（木）')
  })

  it('formats en as Www M/D', () => {
    expect(formatClockDate(8, 13, 'Wed', 'en')).toBe('Wed 8/13')
    expect(formatClockDate(1, 1, 'Thu', 'en')).toBe('Thu 1/1')
  })

  it('does not zero-pad month or day', () => {
    expect(formatClockDate(1, 2, '金', 'ja')).toBe('1/2（金）')
  })
})

describe('WEEKDAY_KEYS', () => {
  it('covers all seven days', () => {
    expect(WEEKDAY_KEYS).toHaveLength(7)
  })

  // Date#getDay() counts from Sunday; a rotated array would still satisfy
  // the length check, so pin every index explicitly.
  it.each([
    [0, 'weekday.sun'],
    [1, 'weekday.mon'],
    [2, 'weekday.tue'],
    [3, 'weekday.wed'],
    [4, 'weekday.thu'],
    [5, 'weekday.fri'],
    [6, 'weekday.sat']
  ])('maps getDay() %i to %s', (index, key) => {
    expect(WEEKDAY_KEYS[index]).toBe(key)
  })
})

describe('msIntoDay', () => {
  it('is 0 at local midnight', () => {
    expect(msIntoDay(0, 0, 0, 0)).toBe(0)
  })

  it('is half a day at noon', () => {
    expect(msIntoDay(12, 0, 0, 0)).toBe(DAY_MS / 2)
  })

  it('reaches DAY_MS - 1 at the last millisecond of the day', () => {
    expect(msIntoDay(23, 59, 59, 999)).toBe(DAY_MS - 1)
  })

  it('stays within [0, DAY_MS) for ordinary times', () => {
    const value = msIntoDay(18, 30, 15, 250)
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThan(DAY_MS)
  })
})

describe('day progress blocks (filledBlocks over DAY_MS)', () => {
  const blocksAt = (h: number, m: number): number =>
    filledBlocks(DAY_MS - msIntoDay(h, m, 0, 0), DAY_MS)

  it('is empty at midnight (rollover resets the bar)', () => {
    expect(blocksAt(0, 0)).toBe(0)
  })

  it('is half full at noon', () => {
    expect(blocksAt(12, 0)).toBe(5)
  })

  it('rounds up at 18:00 (75% of the day)', () => {
    expect(blocksAt(18, 0)).toBe(8)
  })

  it('is full just before midnight', () => {
    expect(blocksAt(23, 59)).toBe(10)
  })
})

// Every instant below is written in UTC and read back in a named zone, so the
// expectations hold whatever timezone the test machine happens to be set to.
describe('zonedClockParts', () => {
  it('reads a zone ahead of UTC', () => {
    expect(zonedClockParts(new Date('2026-08-15T03:04:05Z'), 'Asia/Tokyo')).toEqual({
      hours: 12,
      minutes: 4,
      seconds: 5
    })
  })

  it('reads a zone behind UTC, including the day it lands on', () => {
    expect(zonedClockParts(new Date('2026-08-15T03:04:05Z'), 'America/New_York')).toEqual({
      hours: 23,
      minutes: 4,
      seconds: 5
    })
  })

  it('reads a zone with a half-hour offset', () => {
    expect(zonedClockParts(new Date('2026-08-15T00:00:00Z'), 'Asia/Kolkata')).toEqual({
      hours: 5,
      minutes: 30,
      seconds: 0
    })
  })

  // New York springs forward at 02:00 local on 2026-03-08, which is 07:00 UTC:
  // the minute before is EST (UTC-5), the minute after is EDT (UTC-4), and
  // local 02:xx never happens. Requirement 2.5.
  it('uses the offset in effect either side of a northern spring-forward', () => {
    expect(zonedClockParts(new Date('2026-03-08T06:59:00Z'), 'America/New_York')).toEqual({
      hours: 1,
      minutes: 59,
      seconds: 0
    })
    expect(zonedClockParts(new Date('2026-03-08T07:00:00Z'), 'America/New_York')).toEqual({
      hours: 3,
      minutes: 0,
      seconds: 0
    })
  })

  // Sydney leaves daylight saving at 03:00 local on 2026-04-05, which is 16:00
  // UTC on 2026-04-04: AEDT (UTC+11) becomes AEST (UTC+10), so the wall clock
  // steps backwards and local 02:xx happens twice. Requirement 2.5.
  it('uses the offset in effect either side of a southern transition', () => {
    expect(zonedClockParts(new Date('2026-04-04T15:59:00Z'), 'Australia/Sydney')).toEqual({
      hours: 2,
      minutes: 59,
      seconds: 0
    })
    expect(zonedClockParts(new Date('2026-04-04T16:00:00Z'), 'Australia/Sydney')).toEqual({
      hours: 2,
      minutes: 0,
      seconds: 0
    })
  })

  // Some hour cycles report midnight as 24; the clock would then read "24:07"
  // for an hour every night, so pin the h23 behaviour explicitly.
  it('reports midnight as hour 0, never 24', () => {
    expect(zonedClockParts(new Date('2026-08-15T00:00:00Z'), 'UTC').hours).toBe(0)
    expect(zonedClockParts(new Date('2026-08-15T15:00:00Z'), 'Asia/Tokyo')).toEqual({
      hours: 0,
      minutes: 0,
      seconds: 0
    })
    expect(zonedClockParts(new Date('2026-08-15T15:30:45Z'), 'Asia/Tokyo')).toEqual({
      hours: 0,
      minutes: 30,
      seconds: 45
    })
  })

  it('keeps the hour within [0, 23] across a whole day in every kind of zone', () => {
    const zones = ['UTC', 'Asia/Tokyo', 'America/New_York', 'Pacific/Auckland', 'Asia/Kolkata']
    for (const zone of zones) {
      for (let hour = 0; hour < 24; hour += 1) {
        const parts = zonedClockParts(new Date(Date.UTC(2026, 7, 15, hour)), zone)
        expect(parts.hours, `${zone} at ${hour}:00 UTC`).toBeGreaterThanOrEqual(0)
        expect(parts.hours, `${zone} at ${hour}:00 UTC`).toBeLessThanOrEqual(23)
      }
    }
  })

  // The formatter is cached per zone, so interleaved calls must never hand one
  // zone another zone's formatter.
  it('keeps zones independent when calls interleave', () => {
    const instant = new Date('2026-08-15T00:00:00Z')
    expect(zonedClockParts(instant, 'Asia/Tokyo').hours).toBe(9)
    expect(zonedClockParts(instant, 'Europe/London').hours).toBe(1)
    expect(zonedClockParts(instant, 'Asia/Tokyo').hours).toBe(9)
    expect(zonedClockParts(instant, 'Europe/London').hours).toBe(1)
  })

  // Numbers, not padded strings: the comparison row goes through the same
  // formatter as the home row, with no change to its signature.
  it('feeds formatClock unchanged', () => {
    const parts = zonedClockParts(new Date('2026-08-15T03:04:05Z'), 'Asia/Tokyo')
    expect(formatClock(parts.hours, parts.minutes, parts.seconds, 'hhmmss')).toBe('12:04:05')
    expect(formatClock(parts.hours, parts.minutes, parts.seconds, 'hhmm')).toBe('12:04')
  })
})

describe('shiftInstant', () => {
  it('returns the same moment at zero shift', () => {
    const now = new Date('2026-08-15T03:04:05.678Z')
    expect(shiftInstant(now, 0).getTime()).toBe(now.getTime())
  })

  it('moves forward by whole hours across a date boundary', () => {
    expect(shiftInstant(new Date('2026-08-15T20:34:56.789Z'), 8).toISOString()).toBe(
      '2026-08-16T04:34:56.789Z'
    )
  })

  it('moves backward by whole hours across a date boundary', () => {
    expect(shiftInstant(new Date('2026-08-15T02:34:56.789Z'), -3).toISOString()).toBe(
      '2026-08-14T23:34:56.789Z'
    )
  })

  it('saturates to exactly one day at each end of the range', () => {
    const now = new Date('2026-08-15T09:41:07.250Z')
    expect(shiftInstant(now, SHIFT_HOURS_LIMIT).getTime() - now.getTime()).toBe(DAY_MS)
    expect(now.getTime() - shiftInstant(now, -SHIFT_HOURS_LIMIT).getTime()).toBe(DAY_MS)
  })

  // Requirement 3.5: only the hour moves, so the real minutes and seconds stay
  // on the display and keep ticking.
  it('changes only the hour of the displayed time', () => {
    const now = new Date('2026-08-15T03:04:05Z')
    const base = zonedClockParts(now, 'Asia/Tokyo')
    for (const shift of [-24, -7, -1, 1, 7, 24]) {
      const shifted = zonedClockParts(shiftInstant(now, shift), 'Asia/Tokyo')
      expect(shifted.minutes, `shift ${shift}`).toBe(base.minutes)
      expect(shifted.seconds, `shift ${shift}`).toBe(base.seconds)
      expect(shifted.hours, `shift ${shift}`).toBe((base.hours + shift + 24) % 24)
    }
  })

  it('does not mutate the instant it is given', () => {
    const now = new Date('2026-08-15T09:41:07.250Z')
    shiftInstant(now, 5)
    expect(now.toISOString()).toBe('2026-08-15T09:41:07.250Z')
  })
})

describe('clampShiftHours', () => {
  it('leaves values inside the range untouched', () => {
    expect(clampShiftHours(0)).toBe(0)
    expect(clampShiftHours(8)).toBe(8)
    expect(clampShiftHours(-3)).toBe(-3)
  })

  it('keeps both ends of the range (requirement 3.3)', () => {
    expect(clampShiftHours(SHIFT_HOURS_LIMIT)).toBe(24)
    expect(clampShiftHours(-SHIFT_HOURS_LIMIT)).toBe(-24)
  })

  // Requirement 3.4: scrolling past the end leaves the display unchanged, which
  // only holds if the clamp saturates instead of wrapping.
  it('saturates beyond both ends', () => {
    expect(clampShiftHours(25)).toBe(24)
    expect(clampShiftHours(1000)).toBe(24)
    expect(clampShiftHours(-25)).toBe(-24)
    expect(clampShiftHours(-1000)).toBe(-24)
  })

  it('returns whole hours for fractional input', () => {
    expect(clampShiftHours(3.7)).toBe(3)
    expect(clampShiftHours(-3.7)).toBe(-3)
    expect(clampShiftHours(24.9)).toBe(24)
    // Object.is distinguishes -0 from 0, so this pins zero to one representation.
    expect(clampShiftHours(-0.4)).toBe(0)
    expect(Number.isInteger(clampShiftHours(0.9))).toBe(true)
  })

  it('never escapes the range for non-finite input', () => {
    expect(clampShiftHours(Number.NaN)).toBe(0)
    expect(clampShiftHours(Number.POSITIVE_INFINITY)).toBe(24)
    expect(clampShiftHours(Number.NEGATIVE_INFINITY)).toBe(-24)
  })
})

describe('formatShiftLabel', () => {
  // Requirement 4.3: at zero there is nothing to warn about, so the badge is
  // absent rather than reading "+0h".
  it('is empty at zero shift', () => {
    expect(formatShiftLabel(0, 'h')).toBe('')
    expect(formatShiftLabel(-0, 'h')).toBe('')
  })

  it('signs a forward shift explicitly (requirement 4.1)', () => {
    expect(formatShiftLabel(1, 'h')).toBe('+1h')
    expect(formatShiftLabel(8, 'h')).toBe('+8h')
    expect(formatShiftLabel(SHIFT_HOURS_LIMIT, 'h')).toBe('+24h')
  })

  it('signs a backward shift explicitly (requirement 4.1)', () => {
    expect(formatShiftLabel(-3, 'h')).toBe('-3h')
    expect(formatShiftLabel(-SHIFT_HOURS_LIMIT, 'h')).toBe('-24h')
  })

  // The unit arrives from the caller's dictionary, the way formatClockDate
  // takes its weekday label, so this module resolves no messages itself.
  it('appends the unit it is given verbatim', () => {
    expect(formatShiftLabel(2, '時間')).toBe('+2時間')
    expect(formatShiftLabel(-2, ' hours')).toBe('-2 hours')
  })
})

describe('shift constants', () => {
  it('limits the shift to 24 hours either side (requirement 3.3)', () => {
    expect(SHIFT_HOURS_LIMIT).toBe(24)
  })

  it('returns to the current time after 10 seconds (requirement 5.1)', () => {
    expect(SHIFT_RESET_MS).toBe(10_000)
  })
})
