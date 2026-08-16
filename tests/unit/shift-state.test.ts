import { describe, expect, it } from 'vitest'
import { SHIFT_HOURS_LIMIT } from '../../src/shared/clock'
import { WHEEL_MAX_STEPS_PER_EVENT, WHEEL_STEP_PX } from '../../src/shared/wheel-steps'
import { shiftByDirection, shiftByWheel, type ShiftState } from '../../src/renderer/App'

/**
 * The two shift updaters are pure and exported precisely so they can be tested
 * without a DOM: `App.tsx` touches `document`/`window` only inside effects and
 * lazy initializers, so it imports cleanly under Vitest's node environment.
 * What is covered here is the composition — the wrap, the carried remainder
 * and the input nonce — since a sign or wrap regression there would otherwise
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

  // Requirement 3.4: the end of the range is a wrap, not a wall, so a user who
  // keeps scrolling one way keeps getting a response.
  it('wraps to zero one step past either end', () => {
    const forward = shiftByWheel(state(SHIFT_HOURS_LIMIT), ONE_STEP_UP, PIXEL_MODE)
    expect(forward.hours).toBe(0)

    const back = shiftByWheel(state(-SHIFT_HOURS_LIMIT), ONE_STEP_DOWN, PIXEL_MODE)
    expect(back.hours).toBe(0)
  })

  it('keeps moving after the wrap instead of sticking at zero', () => {
    const wrapped = shiftByWheel(state(SHIFT_HOURS_LIMIT), ONE_STEP_UP, PIXEL_MODE)
    expect(shiftByWheel(wrapped, ONE_STEP_UP, PIXEL_MODE).hours).toBe(1)
  })

  // A fling delivers several steps in one event, and the wrap has to land in
  // the same place either way — otherwise scrolling fast past the end would
  // arrive somewhere scrolling slowly never does. This holds because the
  // accumulator caps an event at WHEEL_MAX_STEPS_PER_EVENT, which keeps the
  // running total close enough to the range to wrap at most once; raising that
  // cap means re-checking this equivalence.
  it.each([1, -1] as const)(
    'lands a multi-step event where the same notches one at a time would (%i)',
    (direction) => {
      const one = direction === 1 ? ONE_STEP_UP : ONE_STEP_DOWN
      const many = one * WHEEL_MAX_STEPS_PER_EVENT

      for (let start = -SHIFT_HOURS_LIMIT; start <= SHIFT_HOURS_LIMIT; start += 1) {
        let stepwise = state(start)
        for (let step = 0; step < WHEEL_MAX_STEPS_PER_EVENT; step += 1) {
          stepwise = shiftByWheel(stepwise, one, PIXEL_MODE)
        }
        expect(shiftByWheel(state(start), many, PIXEL_MODE).hours, `from ${start}`).toBe(
          stepwise.hours
        )
      }
    }
  )

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

  it('bumps the nonce across the wrap, which is what restarts the auto-return', () => {
    const wrapped = shiftByWheel(state(SHIFT_HOURS_LIMIT, 0, 3), ONE_STEP_UP, PIXEL_MODE)
    expect(wrapped.hours).toBe(0)
    expect(wrapped.nonce).toBe(4)
  })
})

describe('shiftByDirection', () => {
  it('steps one hour in each direction', () => {
    expect(shiftByDirection(state(0), 1).hours).toBe(1)
    expect(shiftByDirection(state(0), -1).hours).toBe(-1)
  })

  it('wraps to zero one step past either end', () => {
    expect(shiftByDirection(state(SHIFT_HOURS_LIMIT), 1).hours).toBe(0)
    expect(shiftByDirection(state(-SHIFT_HOURS_LIMIT), -1).hours).toBe(0)
  })

  // Holding the key down should walk the whole range and come back round,
  // visiting every hour on the way rather than stalling at the end.
  it.each([1, -1] as const)('walks a full cycle when held (%i per press)', (direction) => {
    const cycle = SHIFT_HOURS_LIMIT + 1
    let current = state(0)
    const seen: number[] = []
    for (let press = 0; press < cycle; press += 1) {
      current = shiftByDirection(current, direction)
      seen.push(current.hours)
    }
    expect(new Set(seen).size).toBe(cycle)
    expect(current.hours).toBe(0)
  })

  it('drops the wheel remainder, so a keypress ends the gesture it interrupts', () => {
    expect(shiftByDirection(state(0, WHEEL_STEP_PX / 2), 1).remainder).toBe(0)
  })

  it('bumps the nonce on every press, including the one that wraps', () => {
    expect(shiftByDirection(state(0, 0, 1), 1).nonce).toBe(2)
    expect(shiftByDirection(state(SHIFT_HOURS_LIMIT, 0, 5), 1).nonce).toBe(6)
  })
})
