import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  formatClock,
  formatClockDate,
  msIntoDay,
  WEEKDAY_KEYS
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
