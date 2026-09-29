import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClockTimerEngine } from '../../src/main/clock-timer-engine'
import { TimerEngine } from '../../src/main/timer-engine'
import { DEFAULT_SETTINGS } from '../../src/shared/types'

const T0 = 1_000_000_000_000

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ClockTimerEngine lifecycle', () => {
  it('starts idle and reports a started preset immediately', () => {
    vi.spyOn(Date, 'now').mockReturnValue(T0)
    const engine = new ClockTimerEngine()
    expect(engine.snapshot()).toEqual({ status: 'idle', remainingSec: 0, totalSec: 0 })

    expect(engine.start('15m')).toEqual({
      status: 'running',
      remainingSec: 15 * 60,
      totalSec: 15 * 60
    })
    engine.stop()
  })

  it('ticks only while a timer is running', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const engine = new ClockTimerEngine()
    const onUpdate = vi.fn()
    engine.on('update', onUpdate)

    // Idle: no interval is scheduled at all.
    vi.advanceTimersByTime(5000)
    expect(onUpdate).not.toHaveBeenCalled()

    engine.start('15m')
    onUpdate.mockClear()
    vi.advanceTimersByTime(3000)
    expect(onUpdate).toHaveBeenCalledTimes(3)

    engine.cancel()
    onUpdate.mockClear()
    vi.advanceTimersByTime(5000)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe('ClockTimerEngine completion', () => {
  it('emits completed exactly once per timer, even after a long sleep', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0)
    const engine = new ClockTimerEngine()
    const onCompleted = vi.fn()
    engine.on('completed', onCompleted)

    engine.start('15m')
    // Wake far past the end: the first read resolves the overdue timer.
    now.mockReturnValue(T0 + 9 * 60 * 60_000)
    expect(engine.snapshot()).toEqual({ status: 'completed', remainingSec: 0, totalSec: 15 * 60 })
    expect(onCompleted).toHaveBeenCalledTimes(1)

    // Further reads never re-complete.
    expect(engine.snapshot().status).toBe('completed')
    expect(onCompleted).toHaveBeenCalledTimes(1)
    engine.stop()
  })

  it('never emits completed for a cancelled timer', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const engine = new ClockTimerEngine()
    const onCompleted = vi.fn()
    engine.on('completed', onCompleted)

    engine.start('15m')
    vi.advanceTimersByTime(60_000)
    engine.cancel()
    // Run past where the timer would have ended.
    vi.advanceTimersByTime(20 * 60_000)
    expect(onCompleted).not.toHaveBeenCalled()
    expect(engine.snapshot().status).toBe('idle')
  })

  it('replacing a running timer restarts the countdown at the new duration', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0)
    const engine = new ClockTimerEngine()

    engine.start('30m')
    now.mockReturnValue(T0 + 10 * 60_000)
    expect(engine.start('60m')).toEqual({
      status: 'running',
      remainingSec: 60 * 60,
      totalSec: 60 * 60
    })
    engine.stop()
  })

  it('ignores an unknown preset id, leaving the running timer untouched', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const engine = new ClockTimerEngine()

    engine.start('15m')
    expect(engine.start('45m' as never)).toEqual({
      status: 'running',
      remainingSec: 15 * 60,
      totalSec: 15 * 60
    })

    // An unknown id on an idle engine must not begin ticking either: an idle
    // timer never completes, so its interval would never stop itself.
    engine.cancel()
    const onUpdate = vi.fn()
    engine.on('update', onUpdate)
    engine.start('45m' as never)
    vi.advanceTimersByTime(5000)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(engine.snapshot().status).toBe('idle')
  })

  it('dismiss returns a completed timer to idle', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0)
    const engine = new ClockTimerEngine()

    engine.start('15m')
    now.mockReturnValue(T0 + 16 * 60_000)
    expect(engine.snapshot().status).toBe('completed')
    expect(engine.dismiss()).toEqual({ status: 'idle', remainingSec: 0, totalSec: 0 })
  })
})

describe('ClockTimerEngine pause, resume and reset', () => {
  it('stops ticking while paused and never completes during the pause', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const engine = new ClockTimerEngine()
    const onUpdate = vi.fn()
    const onCompleted = vi.fn()
    engine.on('update', onUpdate)
    engine.on('completed', onCompleted)

    engine.start('5m')
    vi.advanceTimersByTime(60_000)
    expect(engine.toggle()).toEqual({ status: 'paused', remainingSec: 4 * 60, totalSec: 5 * 60 })

    onUpdate.mockClear()
    // Far past where the timer would have ended had it kept running.
    vi.advanceTimersByTime(10 * 60_000)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(onCompleted).not.toHaveBeenCalled()
    expect(engine.snapshot()).toEqual({ status: 'paused', remainingSec: 4 * 60, totalSec: 5 * 60 })

    // Resumed, it picks up where it left off and completes on schedule.
    expect(engine.toggle()).toEqual({ status: 'running', remainingSec: 4 * 60, totalSec: 5 * 60 })
    vi.advanceTimersByTime(4 * 60_000)
    expect(onCompleted).toHaveBeenCalledTimes(1)
    expect(engine.snapshot().status).toBe('completed')
  })

  it('completes an overdue timer instead of pausing it at zero', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0)
    const engine = new ClockTimerEngine()
    const onCompleted = vi.fn()
    engine.on('completed', onCompleted)

    engine.start('5m')
    now.mockReturnValue(T0 + 6 * 60_000)
    expect(engine.toggle().status).toBe('completed')
    expect(onCompleted).toHaveBeenCalledTimes(1)
  })

  it('reset winds the timer back to full and holds it paused', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const engine = new ClockTimerEngine()
    const onUpdate = vi.fn()
    engine.on('update', onUpdate)

    engine.start('15m')
    vi.advanceTimersByTime(7 * 60_000)
    expect(engine.reset()).toEqual({ status: 'paused', remainingSec: 15 * 60, totalSec: 15 * 60 })

    onUpdate.mockClear()
    vi.advanceTimersByTime(5000)
    expect(onUpdate).not.toHaveBeenCalled()

    // A completed timer resets the same way, ready to run again.
    engine.toggle()
    vi.advanceTimersByTime(15 * 60_000)
    expect(engine.snapshot().status).toBe('completed')
    expect(engine.reset()).toEqual({ status: 'paused', remainingSec: 15 * 60, totalSec: 15 * 60 })
    engine.stop()
  })

  it('toggle and reset leave an idle engine idle and not ticking', () => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    const engine = new ClockTimerEngine()
    const onUpdate = vi.fn()

    expect(engine.toggle().status).toBe('idle')
    expect(engine.reset().status).toBe('idle')
    engine.on('update', onUpdate)
    vi.advanceTimersByTime(5000)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe('ClockTimerEngine independence from the pomodoro engine', () => {
  it('leaves the pomodoro timer untouched across a full clock-timer run', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0)
    const pomodoro = new TimerEngine(() => ({ ...DEFAULT_SETTINGS }))
    pomodoro.toggle()

    const engine = new ClockTimerEngine()
    engine.start('15m')
    now.mockReturnValue(T0 + 5 * 60_000)
    engine.start('30m')
    engine.cancel()
    engine.start('15m')
    now.mockReturnValue(T0 + 21 * 60_000)
    expect(engine.snapshot().status).toBe('completed')
    engine.dismiss()

    // 21 minutes into a 25-minute work phase, exactly as if the clock timer
    // had never run.
    expect(pomodoro.snapshot()).toMatchObject({
      phase: 'work',
      session: 1,
      running: true,
      remainingSec: 4 * 60
    })
  })
})
