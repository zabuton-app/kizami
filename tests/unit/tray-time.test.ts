import { describe, expect, it } from 'vitest'
import { TRAY_RING_STEPS, trayTime } from '../../src/main/tray-time'

const ON = { trayTime: true, timeDisplay: 'remaining' } as const

describe('trayTime', () => {
  it('shows nothing before the phase has been started', () => {
    expect(trayTime({ fresh: true, remainingSec: 1500, totalSec: 1500 }, ON)).toBeNull()
  })

  it('shows nothing when the user turned it off', () => {
    expect(
      trayTime({ fresh: false, remainingSec: 600, totalSec: 1500 }, { ...ON, trayTime: false })
    ).toBeNull()
  })

  it('reads the time left by default', () => {
    expect(trayTime({ fresh: false, remainingSec: 754, totalSec: 1500 }, ON)?.text).toBe('12:34')
  })

  it('follows the popup when it counts up instead', () => {
    expect(
      trayTime(
        { fresh: false, remainingSec: 600, totalSec: 1500 },
        { ...ON, timeDisplay: 'elapsed' }
      )?.text
    ).toBe('15:00')
  })

  it('reports the elapsed fraction snapped to a ring step', () => {
    const { progress } = trayTime({ fresh: false, remainingSec: 1499, totalSec: 1500 }, ON)!
    expect(progress).toBe(0)
    const half = trayTime({ fresh: false, remainingSec: 750, totalSec: 1500 }, ON)!
    expect(half.progress).toBe(0.5)
    const done = trayTime({ fresh: false, remainingSec: 0, totalSec: 1500 }, ON)!
    expect(done.progress).toBe(1)
  })

  it('changes the ring only once per step, not every second', () => {
    const totalSec = 1500
    const progresses = new Set<number>()
    for (let remainingSec = totalSec; remainingSec >= 0; remainingSec--) {
      progresses.add(trayTime({ fresh: false, remainingSec, totalSec }, ON)!.progress)
    }
    expect(progresses.size).toBe(TRAY_RING_STEPS + 1)
  })

  it('does not divide by zero on an empty phase', () => {
    expect(trayTime({ fresh: false, remainingSec: 0, totalSec: 0 }, ON)?.progress).toBe(0)
  })
})
