import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimerEngine } from '../../src/main/timer-engine'
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types'

const T0 = 1_000_000_000_000

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TimerEngine lifecycle', () => {
  it('does not emit scheduled updates after stop', () => {
    vi.useFakeTimers()
    const engine = new TimerEngine(() => ({ ...DEFAULT_SETTINGS }))
    const onUpdate = vi.fn()
    engine.on('update', onUpdate)

    engine.start()
    vi.advanceTimersByTime(1000)
    expect(onUpdate).toHaveBeenCalledTimes(1)

    engine.stop()
    vi.advanceTimersByTime(2000)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('TimerEngine settings changes', () => {
  it('keeps the original duration and progress of a started phase', () => {
    let settings: Settings = { ...DEFAULT_SETTINGS }
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0)
    const engine = new TimerEngine(() => settings)

    engine.toggle()
    now.mockReturnValue(T0 + 5 * 60_000)
    engine.toggle()

    expect(engine.snapshot()).toMatchObject({
      fresh: false,
      remainingSec: 20 * 60,
      totalSec: 25 * 60,
      filledBlocks: 2
    })

    settings = { ...settings, workMinutes: 20 }
    engine.applySettingsChange(settings)
    expect(engine.snapshot()).toMatchObject({
      fresh: false,
      remainingSec: 20 * 60,
      totalSec: 25 * 60,
      filledBlocks: 2
    })

    settings = { ...settings, workMinutes: 30 }
    engine.applySettingsChange(settings)
    expect(engine.snapshot()).toMatchObject({
      fresh: false,
      remainingSec: 20 * 60,
      totalSec: 25 * 60,
      filledBlocks: 2
    })
  })

  it('applies a duration change while the phase is still fresh', () => {
    let settings: Settings = { ...DEFAULT_SETTINGS }
    vi.spyOn(Date, 'now').mockReturnValue(T0)
    const engine = new TimerEngine(() => settings)

    settings = { ...settings, workMinutes: 30 }
    engine.applySettingsChange(settings)

    expect(engine.snapshot()).toMatchObject({
      fresh: true,
      remainingSec: 30 * 60,
      totalSec: 30 * 60,
      filledBlocks: 0
    })
  })
})

describe('TimerEngine catch-up notifications', () => {
  it('emits only the latest transition after a long sleep', () => {
    const settings: Settings = { ...DEFAULT_SETTINGS }
    const now = vi.spyOn(Date, 'now').mockReturnValue(T0)
    const engine = new TimerEngine(() => settings)
    const transitions: Array<{ from: string; to: string }> = []
    engine.on('transition', (transition) => transitions.push(transition))

    engine.toggle()
    now.mockReturnValue(T0 + 8 * 60 * 60_000)
    engine.toggle()

    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toEqual({ from: 'shortBreak', to: 'work' })
  })
})
