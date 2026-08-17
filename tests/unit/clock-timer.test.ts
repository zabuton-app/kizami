import { describe, expect, it } from 'vitest'
import {
  cancelClockTimer,
  CLOCK_TIMER_PRESETS,
  clockTimerRemainingMs,
  clockTimerSnapshot,
  dismissClockTimer,
  formatClockTimerTime,
  IDLE_CLOCK_TIMER,
  isClockTimerPresetId,
  startClockTimer,
  tickClockTimer,
  type ClockTimerState
} from '../../src/shared/clock-timer'

const T0 = 1_000_000_000_000

describe('clock-timer presets', () => {
  it('offers exactly 5, 10, 15, 30 and 60 minutes', () => {
    expect(CLOCK_TIMER_PRESETS.map((p) => [p.id, p.minutes])).toEqual([
      ['5m', 5],
      ['10m', 10],
      ['15m', 15],
      ['30m', 30],
      ['60m', 60]
    ])
  })

  it('accepts only known preset ids', () => {
    expect(isClockTimerPresetId('5m')).toBe(true)
    expect(isClockTimerPresetId('10m')).toBe(true)
    expect(isClockTimerPresetId('15m')).toBe(true)
    expect(isClockTimerPresetId('30m')).toBe(true)
    expect(isClockTimerPresetId('60m')).toBe(true)
    expect(isClockTimerPresetId('45m')).toBe(false)
    expect(isClockTimerPresetId('1h')).toBe(false)
    expect(isClockTimerPresetId('')).toBe(false)
    expect(isClockTimerPresetId(15)).toBe(false)
    expect(isClockTimerPresetId(null)).toBe(false)
    expect(isClockTimerPresetId(undefined)).toBe(false)
  })
})

describe('startClockTimer', () => {
  it('starts a running timer ending one duration from now', () => {
    expect(startClockTimer('15m', T0)).toEqual({
      status: 'running',
      durationMs: 15 * 60_000,
      endsAt: T0 + 15 * 60_000
    })
    expect(startClockTimer('60m', T0)).toEqual({
      status: 'running',
      durationMs: 60 * 60_000,
      endsAt: T0 + 60 * 60_000
    })
  })

  it('replaces a running timer with a fresh one of the new duration', () => {
    startClockTimer('30m', T0)
    const replaced = startClockTimer('60m', T0 + 10 * 60_000)
    expect(replaced).toEqual({
      status: 'running',
      durationMs: 60 * 60_000,
      endsAt: T0 + 10 * 60_000 + 60 * 60_000
    })
  })

  it('falls back to idle when a bad cast smuggles an unknown id through', () => {
    const state = startClockTimer('45m' as never, T0)
    expect(state).toEqual(IDLE_CLOCK_TIMER)
  })
})

describe('tickClockTimer', () => {
  const running = startClockTimer('15m', T0)

  it('leaves a timer running before its end time', () => {
    const result = tickClockTimer(running, T0 + 14 * 60_000)
    expect(result.state).toBe(running)
    expect(result.justCompleted).toBe(false)
  })

  it('completes exactly at the end time', () => {
    const result = tickClockTimer(running, T0 + 15 * 60_000)
    expect(result.state).toEqual({ status: 'completed', durationMs: 15 * 60_000 })
    expect(result.justCompleted).toBe(true)
  })

  it('completes exactly once even hours past the end time (system sleep)', () => {
    const late = tickClockTimer(running, T0 + 9 * 60 * 60_000)
    expect(late.state).toEqual({ status: 'completed', durationMs: 15 * 60_000 })
    expect(late.justCompleted).toBe(true)

    const again = tickClockTimer(late.state, T0 + 10 * 60 * 60_000)
    expect(again.state).toBe(late.state)
    expect(again.justCompleted).toBe(false)
  })

  it('never completes an idle timer', () => {
    const result = tickClockTimer(IDLE_CLOCK_TIMER, T0 + 365 * 24 * 60 * 60_000)
    expect(result.state).toBe(IDLE_CLOCK_TIMER)
    expect(result.justCompleted).toBe(false)
  })
})

describe('cancelClockTimer / dismissClockTimer', () => {
  it('cancel drops a running timer back to idle', () => {
    expect(cancelClockTimer()).toEqual(IDLE_CLOCK_TIMER)
  })

  it('dismiss acknowledges a completed timer', () => {
    const completed: ClockTimerState = { status: 'completed', durationMs: 30 * 60_000 }
    expect(dismissClockTimer(completed)).toEqual(IDLE_CLOCK_TIMER)
  })

  it('dismiss leaves idle and running timers untouched', () => {
    const running = startClockTimer('30m', T0)
    expect(dismissClockTimer(IDLE_CLOCK_TIMER)).toBe(IDLE_CLOCK_TIMER)
    expect(dismissClockTimer(running)).toBe(running)
  })
})

describe('clockTimerRemainingMs', () => {
  const running = startClockTimer('30m', T0)

  it('derives the remaining time from the wall clock', () => {
    expect(clockTimerRemainingMs(running, T0)).toBe(30 * 60_000)
    expect(clockTimerRemainingMs(running, T0 + 12 * 60_000)).toBe(18 * 60_000)
  })

  it('clamps to zero past the end and reports zero when not running', () => {
    expect(clockTimerRemainingMs(running, T0 + 31 * 60_000)).toBe(0)
    expect(clockTimerRemainingMs(IDLE_CLOCK_TIMER, T0)).toBe(0)
    expect(clockTimerRemainingMs({ status: 'completed', durationMs: 60_000 }, T0)).toBe(0)
  })
})

describe('clockTimerSnapshot', () => {
  it('reports an idle timer as all zeros', () => {
    expect(clockTimerSnapshot(IDLE_CLOCK_TIMER, T0)).toEqual({
      status: 'idle',
      remainingSec: 0,
      totalSec: 0
    })
  })

  it('rounds the remaining seconds up like the pomodoro snapshot', () => {
    const running = startClockTimer('15m', T0)
    expect(clockTimerSnapshot(running, T0 + 1)).toEqual({
      status: 'running',
      remainingSec: 15 * 60,
      totalSec: 15 * 60
    })
    expect(clockTimerSnapshot(running, T0 + 1000)).toEqual({
      status: 'running',
      remainingSec: 15 * 60 - 1,
      totalSec: 15 * 60
    })
  })

  it('keeps the finished duration visible in the completed state', () => {
    expect(clockTimerSnapshot({ status: 'completed', durationMs: 60 * 60_000 }, T0)).toEqual({
      status: 'completed',
      remainingSec: 0,
      totalSec: 60 * 60
    })
  })
})

describe('formatClockTimerTime', () => {
  it('formats under an hour as mm:ss', () => {
    expect(formatClockTimerTime(15 * 60)).toBe('15:00')
    expect(formatClockTimerTime(61)).toBe('01:01')
    expect(formatClockTimerTime(0)).toBe('00:00')
  })

  it('formats an hour and up as h:mm:ss with an unpadded hour', () => {
    expect(formatClockTimerTime(60 * 60)).toBe('1:00:00')
    expect(formatClockTimerTime(60 * 60 - 1)).toBe('59:59')
    expect(formatClockTimerTime(60 * 60 + 5)).toBe('1:00:05')
  })

  it('clamps a negative input to zero', () => {
    expect(formatClockTimerTime(-5)).toBe('00:00')
  })
})
