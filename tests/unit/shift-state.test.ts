import { describe, expect, it } from 'vitest'
import { SHIFT_HOURS_LIMIT } from '../../src/shared/clock'
import { WHEEL_STEP_PX } from '../../src/shared/wheel-steps'
import { shiftByDirection, shiftByWheel, type ShiftState } from '../../src/renderer/App'

/**
 * The two shift updaters are pure and exported precisely so they can be tested
 * without a DOM: `App.tsx` touches `document`/`window` only inside effects and
 * lazy initializers, so it imports cleanly under Vitest's node environment.
 * What is covered here is the composition — the clamp, the carried remainder
 * and the input nonce — since a sign or clamp regression there would otherwise
 * only show up by hand in the built app.
 */

/** Pixel-mode delta that scrolls upward, which the accumulator reads as forward. */
const ONE_STEP_UP = -WHEEL_STEP_PX

/** Pixel-mode delta that scrolls downward, which the accumulator reads as back. */
const ONE_STEP_DOWN = WHEEL_STEP_PX

const PIXEL_MODE = 0

function state(hours: number, remainder = 0, nonce = 0): ShiftState {
  return { hours, remainder, nonce }
}

describe('shiftByWheel', () => {
  it('moves the clock forward for an upward scroll and back for a downward one', () => {
    expect(shiftByWheel(state(0), ONE_STEP_UP, PIXEL_MODE).hours).toBe(1)
    expect(shiftByWheel(state(0), ONE_STEP_DOWN, PIXEL_MODE).hours).toBe(-1)
  })

  it('saturates at both ends of the allowed range instead of wrapping', () => {
    const forward = shiftByWheel(state(SHIFT_HOURS_LIMIT), ONE_STEP_UP, PIXEL_MODE)
    expect(forward.hours).toBe(SHIFT_HOURS_LIMIT)

    const back = shiftByWheel(state(-SHIFT_HOURS_LIMIT), ONE_STEP_DOWN, PIXEL_MODE)
    expect(back.hours).toBe(-SHIFT_HOURS_LIMIT)
  })

  it('carries the sub-step remainder across events until it crosses a step', () => {
    const half = shiftByWheel(state(0), ONE_STEP_UP / 2, PIXEL_MODE)
    expect(half.hours).toBe(0)
    expect(half.remainder).toBe(WHEEL_STEP_PX / 2)

    // The second half of the same gesture only moves the clock because the
    // first half's remainder was carried into it.
    const whole = shiftByWheel(half, ONE_STEP_UP / 2, PIXEL_MODE)
    expect(whole.hours).toBe(1)
  })

  it('bumps the nonce on every event, including one that changes nothing', () => {
    const half = shiftByWheel(state(0, 0, 7), ONE_STEP_UP / 2, PIXEL_MODE)
    expect(half.hours).toBe(0)
    expect(half.nonce).toBe(8)
  })

  it('bumps the nonce while saturated, which is what restarts the auto-return', () => {
    const saturated = shiftByWheel(state(SHIFT_HOURS_LIMIT, 0, 3), ONE_STEP_UP, PIXEL_MODE)
    expect(saturated.hours).toBe(SHIFT_HOURS_LIMIT)
    expect(saturated.nonce).toBe(4)
  })
})

describe('shiftByDirection', () => {
  it('steps one hour in each direction', () => {
    expect(shiftByDirection(state(0), 1).hours).toBe(1)
    expect(shiftByDirection(state(0), -1).hours).toBe(-1)
  })

  it('saturates at both ends of the allowed range', () => {
    expect(shiftByDirection(state(SHIFT_HOURS_LIMIT), 1).hours).toBe(SHIFT_HOURS_LIMIT)
    expect(shiftByDirection(state(-SHIFT_HOURS_LIMIT), -1).hours).toBe(-SHIFT_HOURS_LIMIT)
  })

  it('drops the wheel remainder, so a keypress ends the gesture it interrupts', () => {
    expect(shiftByDirection(state(0, WHEEL_STEP_PX / 2), 1).remainder).toBe(0)
  })

  it('bumps the nonce on every press, including one against the end of the range', () => {
    expect(shiftByDirection(state(0, 0, 1), 1).nonce).toBe(2)
    expect(shiftByDirection(state(SHIFT_HOURS_LIMIT, 0, 5), 1).nonce).toBe(6)
  })
})
