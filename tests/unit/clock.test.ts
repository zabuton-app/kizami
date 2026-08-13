import { describe, expect, it } from 'vitest'
import { DAY_MS, formatClock, msIntoDay } from '../../src/shared/clock'
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
