import { describe, expect, it } from 'vitest'
import {
  createInitialState,
  displaySec,
  filledBlocks,
  formatTime,
  isFresh,
  phaseDurationMs,
  remainingMsAt,
  skip,
  tick,
  toggle
} from '../../src/shared/timer-logic'
import { DEFAULT_SETTINGS, type Settings, type TimerState } from '../../src/shared/types'

const T0 = 1_000_000_000_000

const settings: Settings = { ...DEFAULT_SETTINGS }
const noAutoStart: Settings = { ...DEFAULT_SETTINGS, autoStart: false }

function runningWork(now: number, s: Settings = settings): TimerState {
  return toggle(createInitialState(s), now)
}

describe('createInitialState', () => {
  it('starts at work phase, session 1, paused, full duration', () => {
    const state = createInitialState(settings)
    expect(state).toEqual({
      phase: 'work',
      session: 1,
      running: false,
      started: false,
      endsAt: null,
      remainingMs: 25 * 60_000,
      totalMs: 25 * 60_000
    })
    expect(isFresh(state)).toBe(true)
  })
})

describe('toggle', () => {
  it('starts the timer with endsAt = now + remaining', () => {
    const state = runningWork(T0)
    expect(state.running).toBe(true)
    expect(state.endsAt).toBe(T0 + 25 * 60_000)
    expect(isFresh(state)).toBe(false)
  })

  it('pauses keeping the remaining time', () => {
    const started = runningWork(T0)
    const paused = toggle(started, T0 + 5 * 60_000)
    expect(paused.running).toBe(false)
    expect(paused.endsAt).toBeNull()
    expect(paused.remainingMs).toBe(20 * 60_000)
  })

  it('resumes from the paused remaining time', () => {
    const paused = toggle(runningWork(T0), T0 + 5 * 60_000)
    const resumed = toggle(paused, T0 + 9 * 60_000)
    expect(resumed.running).toBe(true)
    expect(resumed.endsAt).toBe(T0 + 9 * 60_000 + 20 * 60_000)
  })
})

describe('tick transitions', () => {
  it('does nothing before the phase ends', () => {
    const state = runningWork(T0)
    const result = tick(state, settings, T0 + 60_000)
    expect(result.transitions).toEqual([])
    expect(result.state).toBe(state)
  })

  it('moves work -> shortBreak for sessions 1-3', () => {
    const state = runningWork(T0)
    const result = tick(state, settings, T0 + 25 * 60_000)
    expect(result.transitions).toEqual([{ from: 'work', to: 'shortBreak' }])
    expect(result.state.phase).toBe('shortBreak')
    expect(result.state.session).toBe(1)
    expect(result.state.running).toBe(true)
    // Next phase starts at the boundary, not at the tick time.
    expect(result.state.endsAt).toBe(T0 + 25 * 60_000 + 5 * 60_000)
  })

  it('moves work -> longBreak on session 4', () => {
    let state: TimerState = { ...runningWork(T0), session: 4 }
    const result = tick(state, settings, T0 + 25 * 60_000)
    expect(result.state.phase).toBe('longBreak')
    expect(result.state.session).toBe(4)
    state = result.state
    // longBreak -> work resets to session 1.
    const after = tick(state, settings, (state.endsAt ?? 0) + 1)
    expect(after.state.phase).toBe('work')
    expect(after.state.session).toBe(1)
  })

  it('moves shortBreak -> work incrementing the session', () => {
    const work = tick(runningWork(T0), settings, T0 + 25 * 60_000).state
    const result = tick(work, settings, T0 + 30 * 60_000)
    expect(result.transitions).toEqual([{ from: 'shortBreak', to: 'work' }])
    expect(result.state.session).toBe(2)
  })

  it('catches up across multiple phases after a long sleep', () => {
    const state = runningWork(T0)
    // Sleep past work (25) + short break (5) + 1 minute into the next work.
    const now = T0 + 31 * 60_000
    const result = tick(state, settings, now)
    expect(result.transitions).toEqual([
      { from: 'work', to: 'shortBreak' },
      { from: 'shortBreak', to: 'work' }
    ])
    expect(result.state.phase).toBe('work')
    expect(result.state.session).toBe(2)
    expect(remainingMsAt(result.state, now)).toBe(24 * 60_000)
  })

  it('stops waiting at the next phase when autoStart is off', () => {
    const state = runningWork(T0, noAutoStart)
    const result = tick(state, noAutoStart, T0 + 60 * 60_000)
    expect(result.transitions).toEqual([{ from: 'work', to: 'shortBreak' }])
    expect(result.state.running).toBe(false)
    expect(result.state.remainingMs).toBe(5 * 60_000)
    expect(isFresh(result.state)).toBe(true)
  })
})

describe('skip', () => {
  it('skips a running phase to the next one from now', () => {
    const state = runningWork(T0)
    const now = T0 + 10 * 60_000
    const result = skip(state, settings, now)
    expect(result.transitions).toEqual([{ from: 'work', to: 'shortBreak' }])
    expect(result.state.endsAt).toBe(now + 5 * 60_000)
  })

  it('works while paused too', () => {
    const state = createInitialState(settings)
    const result = skip(state, settings, T0)
    expect(result.state.phase).toBe('shortBreak')
    expect(result.state.running).toBe(true)
  })

  it('respects autoStart=false', () => {
    const result = skip(createInitialState(noAutoStart), noAutoStart, T0)
    expect(result.state.running).toBe(false)
    expect(result.state.remainingMs).toBe(5 * 60_000)
  })
})

describe('phaseDurationMs', () => {
  it('maps each phase to its configured minutes', () => {
    expect(phaseDurationMs('work', settings)).toBe(25 * 60_000)
    expect(phaseDurationMs('shortBreak', settings)).toBe(5 * 60_000)
    expect(phaseDurationMs('longBreak', settings)).toBe(15 * 60_000)
  })
})

describe('filledBlocks', () => {
  it('is 0 at full remaining and 10 at zero remaining', () => {
    expect(filledBlocks(1_500_000, 1_500_000)).toBe(0)
    expect(filledBlocks(0, 1_500_000)).toBe(10)
  })

  it('rounds to the nearest block', () => {
    expect(filledBlocks(750_000, 1_500_000)).toBe(5)
    expect(filledBlocks(1_425_000, 1_500_000)).toBe(1)
  })

  it('is safe for zero total', () => {
    expect(filledBlocks(0, 0)).toBe(0)
  })
})

describe('formatTime', () => {
  it('formats MM:SS with padding', () => {
    expect(formatTime(0)).toBe('00:00')
    expect(formatTime(65)).toBe('01:05')
    expect(formatTime(25 * 60)).toBe('25:00')
  })
})

describe('displaySec', () => {
  const total = 25 * 60

  it('returns the remaining seconds unchanged in remaining mode', () => {
    expect(displaySec(total, total, 'remaining')).toBe(total)
    expect(displaySec(900, total, 'remaining')).toBe(900)
    expect(displaySec(0, total, 'remaining')).toBe(0)
  })

  it('counts up from zero in elapsed mode', () => {
    // A phase that has never been started shows 00:00, not its full length.
    expect(displaySec(total, total, 'elapsed')).toBe(0)
    expect(displaySec(900, total, 'elapsed')).toBe(600)
    expect(displaySec(1, total, 'elapsed')).toBe(total - 1)
    expect(displaySec(0, total, 'elapsed')).toBe(total)
  })

  it('stays within 0..totalSec for both modes', () => {
    for (const mode of ['remaining', 'elapsed'] as const) {
      for (const remaining of [-5, 0, 1, 900, total, total + 5]) {
        const value = displaySec(remaining, total, mode)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(total)
      }
    }
  })

  it('keeps remaining + elapsed equal to the phase total', () => {
    for (const remaining of [0, 1, 599, 900, total]) {
      expect(
        displaySec(remaining, total, 'remaining') + displaySec(remaining, total, 'elapsed')
      ).toBe(total)
    }
  })

  it('is safe for a zero total', () => {
    expect(displaySec(0, 0, 'remaining')).toBe(0)
    expect(displaySec(0, 0, 'elapsed')).toBe(0)
  })
})
