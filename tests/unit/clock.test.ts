import { describe, expect, it } from 'vitest'
import type { ClockRowsInput } from '../../src/shared/clock'
import {
  buildClockRows,
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

describe('buildClockRows', () => {
  // One complete input with only the pieces a test cares about overridden, so
  // the shape of ClockRowsInput is written out once.
  const rowsInput = (overrides: Partial<ClockRowsInput> = {}): ClockRowsInput => ({
    now: new Date('2026-08-15T03:04:05Z'),
    shiftHours: 0,
    format: 'hhmmss',
    homeLabel: 'Home',
    secondary: null,
    ...overrides
  })

  // The zone's offset from UTC at an instant, read straight from Intl rather
  // than through the module under test, so the offset assertion is independent.
  const offsetMinutes = (zone: string, instant: Date): number => {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(instant)
      .find((part) => part.type === 'timeZoneName')
    const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name?.value ?? '')
    if (match === null) {
      // Intl abbreviates a zero offset to a bare "GMT".
      return 0
    }
    const magnitude = Number(match[2]) * 60 + Number(match[3])
    return match[1] === '-' ? -magnitude : magnitude
  }

  const minutesOfDay = (time: string): number => {
    const [hours, minutes] = time.split(':')
    return Number(hours) * 60 + Number(minutes)
  }

  // Two wall clocks are only ever compared the short way round the dial.
  const wrapMinutes = (value: number): number => ((((value + 720) % 1440) + 1440) % 1440) - 720

  // Requirements 2.3 and 2.8: alone, the home row has nothing to be told apart
  // from, so it carries no label and 007's single-row layout is unchanged.
  it('returns one unlabeled row when no comparison zone is set', () => {
    const rows = buildClockRows(rowsInput())
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('home')
    expect(rows[0].label).toBeNull()
  })

  // Requirements 2.2 and 2.8: the comparison row comes second and both rows are
  // labeled, so the user can tell which place each row represents.
  it('returns two labeled rows in home-then-comparison order', () => {
    const rows = buildClockRows(
      rowsInput({ homeLabel: '自宅', secondary: { zone: 'Asia/Tokyo', label: '東京' } })
    )
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.key)).toEqual(['home', 'secondary'])
    expect(rows.map((row) => row.label)).toEqual(['自宅', '東京'])
  })

  // Requirement 2.1: the home row is the local wall clock at the shifted
  // instant, whatever zone the machine running this happens to be in.
  it('derives the home row from the local wall clock', () => {
    const now = new Date('2026-08-15T03:04:05Z')
    for (const shiftHours of [-24, -3, 0, 3, 24]) {
      const instant = shiftInstant(now, shiftHours)
      const rows = buildClockRows(
        rowsInput({ now, shiftHours, secondary: { zone: 'UTC', label: 'UTC' } })
      )
      expect(rows[0].time, `shift ${shiftHours}`).toBe(
        formatClock(instant.getHours(), instant.getMinutes(), instant.getSeconds(), 'hhmmss')
      )
    }
  })

  // Requirement 2.7, by moving the zone underneath the module: Node re-reads
  // process.env.TZ for every Date, so this is as close as a unit test gets to
  // the operating system's zone changing while the clock is running.
  it('follows a change to the operating system zone', () => {
    const original = process.env.TZ
    try {
      const input = rowsInput({ secondary: { zone: 'Asia/Tokyo', label: 'Tokyo' } })
      process.env.TZ = 'UTC'
      expect(buildClockRows(input)[0].time).toBe('03:04:05')
      process.env.TZ = 'America/New_York'
      expect(buildClockRows(input)[0].time).toBe('23:04:05')
      process.env.TZ = 'Asia/Kolkata'
      expect(buildClockRows(input)[0].time).toBe('08:34:05')
      // The comparison row goes through Intl with an explicit zone, so it is
      // unmoved by any of this.
      expect(buildClockRows(input)[1].time).toBe('12:04:05')
    } finally {
      if (original === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = original
      }
    }
  })

  // Requirement 3.2: both rows are derived from one shifted instant, so the gap
  // between them is always the zones' real offset at that moment.
  it('keeps both rows on one instant, a real zone offset apart', () => {
    const now = new Date('2026-08-15T03:04:05Z')
    const zones = ['UTC', 'Asia/Tokyo', 'America/New_York', 'Asia/Kolkata', 'Pacific/Auckland']
    const differences = new Set<number>()
    for (const zone of zones) {
      for (const shiftHours of [-24, -5, 0, 5, 24]) {
        const rows = buildClockRows(
          rowsInput({ now, shiftHours, format: 'hhmm', secondary: { zone, label: zone } })
        )
        const instant = shiftInstant(now, shiftHours)
        // getTimezoneOffset() is UTC minus local, so adding it removes the
        // local offset and leaves the gap between the two zones.
        const expected = wrapMinutes(offsetMinutes(zone, instant) + instant.getTimezoneOffset())
        const actual = wrapMinutes(minutesOfDay(rows[1].time) - minutesOfDay(rows[0].time))
        expect(actual, `${zone} at shift ${shiftHours}`).toBe(expected)
        differences.add(actual)
      }
    }
    // These five zones hold five distinct offsets, so at most one of them can
    // match the machine's own: a run where every row pair agreed would mean the
    // comparison row was not being converted at all.
    expect([...differences].some((difference) => difference !== 0)).toBe(true)
  })

  // Requirement 2.4: one format choice covers both rows.
  it('renders every row in the selected clock format', () => {
    const base = rowsInput({ secondary: { zone: 'Asia/Tokyo', label: 'Tokyo' } })
    const short = buildClockRows({ ...base, format: 'hhmm' })
    const long = buildClockRows({ ...base, format: 'hhmmss' })
    for (const row of short) {
      expect(row.time).toMatch(/^\d{2}:\d{2}$/)
    }
    for (const row of long) {
      expect(row.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    }
    expect(long.map((row) => row.time.slice(0, 5))).toEqual(short.map((row) => row.time))
    expect(long[1].time).toBe('12:04:05')
    expect(short[1].time).toBe('12:04')
    // The lone home row honours the choice too.
    expect(buildClockRows({ ...base, secondary: null, format: 'hhmm' })[0].time).toMatch(
      /^\d{2}:\d{2}$/
    )
  })

  // Requirement 3.2 with the shift crossing a date boundary: the comparison row
  // lands on the next day rather than wrapping within the same one.
  it('shifts across a date boundary', () => {
    const rows = buildClockRows(
      rowsInput({
        now: new Date('2026-08-15T20:34:56Z'),
        shiftHours: 8,
        secondary: { zone: 'Asia/Tokyo', label: 'Tokyo' }
      })
    )
    // 20:34:56Z plus 8h is 04:34:56Z the next day, which is 13:34:56 in Tokyo.
    expect(rows[1].time).toBe('13:34:56')
  })

  // Requirement 3.5: the shift moves whole hours only, so the real minutes and
  // seconds stay on the display and keep advancing as time passes.
  it('keeps the minutes and seconds of the instant it is given', () => {
    for (const shiftHours of [-24, -7, -1, 0, 1, 7, 24]) {
      const rows = buildClockRows(
        rowsInput({ shiftHours, secondary: { zone: 'Asia/Tokyo', label: 'Tokyo' } })
      )
      expect(rows[1].time.slice(3), `shift ${shiftHours}`).toBe('04:05')
    }
    const ticked = buildClockRows(
      rowsInput({
        now: new Date('2026-08-15T03:04:06Z'),
        shiftHours: 5,
        secondary: { zone: 'Asia/Tokyo', label: 'Tokyo' }
      })
    )
    expect(ticked[1].time.slice(3)).toBe('04:06')
  })

  // Requirement 6.4: the caller supplies the instant, so the builder reads no
  // clock of its own. An instant decades from now has to survive intact, which
  // a hidden `new Date()` anywhere in the builder would break.
  it('renders the instant it is given rather than the current time', () => {
    const rows = buildClockRows(
      rowsInput({
        now: new Date('2000-01-01T00:00:00Z'),
        shiftHours: 3,
        secondary: { zone: 'UTC', label: 'UTC' }
      })
    )
    expect(rows[1].time).toBe('03:00:00')
  })

  it('does not mutate the instant it is given', () => {
    const now = new Date('2026-08-15T03:04:05.678Z')
    buildClockRows(
      rowsInput({ now, shiftHours: 6, secondary: { zone: 'Asia/Tokyo', label: 'Tokyo' } })
    )
    expect(now.toISOString()).toBe('2026-08-15T03:04:05.678Z')
  })

  // The per-zone formatter cache is what keeps a once-a-second tick cheap.
  // Without this, deleting the cache lookup would leave the suite green.
  // Africa/Cairo is used nowhere else in this file, so the count is exact.
  it('builds one formatter per comparison zone across ticks', () => {
    const real = Intl.DateTimeFormat
    let constructions = 0
    // A Proxy rather than a spy: Intl.DateTimeFormat has to stay constructible
    // and keep its statics, and a plain mock returns an object without any of
    // the formatting methods the module then calls.
    Intl.DateTimeFormat = new Proxy(real, {
      construct(target, args, newTarget) {
        constructions += 1
        return Reflect.construct(target, args, newTarget)
      }
    })
    try {
      for (let second = 0; second < 5; second += 1) {
        buildClockRows(
          rowsInput({
            now: new Date(Date.UTC(2026, 7, 15, 3, 4, second)),
            secondary: { zone: 'Africa/Cairo', label: 'Cairo' }
          })
        )
      }
      expect(constructions).toBe(1)
    } finally {
      Intl.DateTimeFormat = real
    }
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
