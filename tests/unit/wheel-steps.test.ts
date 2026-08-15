import { describe, expect, it } from 'vitest'
import {
  accumulateWheelSteps,
  WHEEL_MAX_STEPS_PER_EVENT,
  WHEEL_STEP_PX,
  type WheelStepResult
} from '../../src/shared/wheel-steps'

/** DOM `WheelEvent.deltaMode` constants, named so the tests read as the DOM does. */
const PIXEL_MODE = 0
const LINE_MODE = 1
const PAGE_MODE = 2

/**
 * Feed a stream of deltas through the accumulator the way a caller would,
 * carrying the remainder from one event to the next, and report the steps each
 * event produced. This is also the shape that proves the module is stateless:
 * the only thing linking two calls is the value the caller passes back in.
 */
function feed(
  deltas: readonly number[],
  deltaMode: number = PIXEL_MODE
): { steps: number[]; total: number; remainder: number } {
  let remainder = 0
  const steps: number[] = []
  for (const delta of deltas) {
    const result = accumulateWheelSteps(remainder, delta, deltaMode)
    steps.push(result.steps)
    remainder = result.remainder
  }
  return { steps, total: steps.reduce((sum, value) => sum + value, 0), remainder }
}

describe('wheel constants', () => {
  it('advances one hour per 100px of scrolling', () => {
    expect(WHEEL_STEP_PX).toBe(100)
  })

  it('caps a single event at three hours', () => {
    expect(WHEEL_MAX_STEPS_PER_EVENT).toBe(3)
  })
})

describe('accumulateWheelSteps direction', () => {
  // The sign convention is the one thing a reader will assume backwards:
  // scrolling the wheel away from the user is upward, the DOM reports that as
  // a negative deltaY, and the clock must move forward. Requirement 3.1.
  it('steps forward for an upward scroll (negative deltaY)', () => {
    expect(accumulateWheelSteps(0, -120, PIXEL_MODE).steps).toBe(1)
  })

  it('steps backward for a downward scroll (positive deltaY)', () => {
    expect(accumulateWheelSteps(0, 120, PIXEL_MODE).steps).toBe(-1)
  })

  it('is antisymmetric: mirroring the input mirrors the steps', () => {
    // Summing rather than negating, so that a zero on one side and a -0 on the
    // other does not read as a failure.
    for (const delta of [40, 100, 137, 260, 1000]) {
      const up = accumulateWheelSteps(0, -delta, PIXEL_MODE)
      const down = accumulateWheelSteps(0, delta, PIXEL_MODE)
      expect(up.steps + down.steps, `delta ${delta}`).toBe(0)
      expect(up.remainder + down.remainder, `delta ${delta}`).toBe(0)
      expect(Math.abs(up.steps), `delta ${delta}`).toBe(Math.abs(down.steps))
    }
  })
})

describe('accumulateWheelSteps with a mouse wheel', () => {
  // Chromium reports a notch as roughly 100-120px depending on the platform;
  // every one of them has to be exactly one hour. Requirement 3.1.
  it.each([100, 114, 120, 133])('turns a %ipx notch into exactly one step', (notch) => {
    expect(accumulateWheelSteps(0, -notch, PIXEL_MODE).steps).toBe(1)
    expect(accumulateWheelSteps(0, notch, PIXEL_MODE).steps).toBe(-1)
  })

  it('turns a run of notches into one step each', () => {
    const { steps, total } = feed([-114, -114, -114, -114])
    expect(steps).toEqual([1, 1, 1, 1])
    expect(total).toBe(4)
  })
})

describe('accumulateWheelSteps with a trackpad', () => {
  // A trackpad emits a stream of small deltas. None of them is a step on its
  // own; the caller-held remainder is what turns the burst into one hour.
  it('accumulates small deltas into one step at the threshold', () => {
    const burst = Array.from({ length: 9 }, () => -12)
    const { steps, total, remainder } = feed(burst)
    expect(steps.slice(0, 8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(steps[8]).toBe(1)
    expect(total).toBe(1)
    expect(remainder).toBe(108 - WHEEL_STEP_PX)
  })

  it('does not step until the accumulated distance crosses the threshold', () => {
    const { total, remainder } = feed([-30, -30, -30])
    expect(total).toBe(0)
    expect(remainder).toBe(90)
  })

  it('carries the leftover into the next burst rather than dropping it', () => {
    const first = accumulateWheelSteps(0, -90, PIXEL_MODE)
    expect(first.steps).toBe(0)
    const second = accumulateWheelSteps(first.remainder, -20, PIXEL_MODE)
    expect(second.steps).toBe(1)
    expect(second.remainder).toBe(10)
  })
})

describe('accumulateWheelSteps on a direction reversal', () => {
  // Without discarding the remainder, the user would have to scroll off the
  // 60px of forward progress before the clock moved backward at all.
  it('steps on the first opposing event instead of unwinding the remainder', () => {
    const forward = accumulateWheelSteps(0, -60, PIXEL_MODE)
    expect(forward.steps).toBe(0)
    expect(forward.remainder).toBe(60)

    const reversal = accumulateWheelSteps(forward.remainder, 100, PIXEL_MODE)
    expect(reversal.steps).toBe(-1)
  })

  it('discards the remainder in both directions', () => {
    const backward = accumulateWheelSteps(0, 60, PIXEL_MODE)
    expect(backward.remainder).toBe(-60)
    expect(accumulateWheelSteps(backward.remainder, -100, PIXEL_MODE).steps).toBe(1)
  })

  it('restarts the accumulation from the opposing event alone', () => {
    // 90px forward then 40px back: the reversal is below the threshold, so no
    // step yet, and the remainder reflects only the new direction.
    const result = accumulateWheelSteps(90, 40, PIXEL_MODE)
    expect(result.steps).toBe(0)
    expect(result.remainder).toBe(-40)
  })

  it('keeps the remainder when the delta is zero, which has no direction', () => {
    const result = accumulateWheelSteps(60, 0, PIXEL_MODE)
    expect(result.steps).toBe(0)
    expect(result.remainder).toBe(60)
  })
})

describe('accumulateWheelSteps with a fling', () => {
  // Momentum scrolling can deliver thousands of pixels in one event; without a
  // cap that would cross the whole shift range in a single frame.
  it.each([500, 1000, 5000, 100_000])('caps a %ipx fling at the maximum', (fling) => {
    expect(accumulateWheelSteps(0, -fling, PIXEL_MODE).steps).toBe(WHEEL_MAX_STEPS_PER_EVENT)
    expect(accumulateWheelSteps(0, fling, PIXEL_MODE).steps).toBe(-WHEEL_MAX_STEPS_PER_EVENT)
  })

  it('leaves the cap unreached for an event just below it', () => {
    expect(accumulateWheelSteps(0, -299, PIXEL_MODE).steps).toBe(2)
    expect(accumulateWheelSteps(0, -300, PIXEL_MODE).steps).toBe(WHEEL_MAX_STEPS_PER_EVENT)
  })
})

describe('accumulateWheelSteps delta modes', () => {
  // Firefox reports lines and some setups report pages; one notch has to mean
  // one hour whatever units the platform chose. Requirement 3.6 rides on this
  // too, since the mini bar receives the same events.
  it.each([-1, -3, -7, 0, 2, 6.25])('reads line mode %s as 16px per line', (delta) => {
    expect(accumulateWheelSteps(0, delta, LINE_MODE)).toEqual(
      accumulateWheelSteps(0, delta * 16, PIXEL_MODE)
    )
  })

  it.each([-0.5, -1, -2, 1, 3])('reads page mode %s as 100px per page', (delta) => {
    expect(accumulateWheelSteps(0, delta, PAGE_MODE)).toEqual(
      accumulateWheelSteps(0, delta * 100, PIXEL_MODE)
    )
  })

  it('turns one page into one step', () => {
    expect(accumulateWheelSteps(0, -1, PAGE_MODE).steps).toBe(1)
  })

  it('accumulates line-mode deltas the same way pixel mode does', () => {
    expect(feed([-3, -3, -3], LINE_MODE)).toEqual(feed([-48, -48, -48], PIXEL_MODE))
  })

  it('treats an unknown delta mode as pixels', () => {
    for (const mode of [3, -1, 99, Number.NaN, 1.5]) {
      expect(accumulateWheelSteps(0, -120, mode), `mode ${mode}`).toEqual(
        accumulateWheelSteps(0, -120, PIXEL_MODE)
      )
    }
  })
})

describe('accumulateWheelSteps with hostile input', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'yields no step for a deltaY of %s',
    (delta) => {
      expect(accumulateWheelSteps(0, delta, PIXEL_MODE).steps).toBe(0)
    }
  )

  it('leaves a gesture in progress untouched by a non-finite deltaY', () => {
    const result = accumulateWheelSteps(60, Number.NaN, PIXEL_MODE)
    expect(result).toEqual({ steps: 0, remainder: 60 })
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'recovers from a non-finite remainder of %s',
    (remainder) => {
      expect(accumulateWheelSteps(remainder, -120, PIXEL_MODE)).toEqual({ steps: 0, remainder: 0 })
    }
  )

  // A page-mode delta near the float ceiling overflows to Infinity once it is
  // scaled, so the result still has to come back finite and bounded.
  it('stays finite when scaling overflows', () => {
    const result = accumulateWheelSteps(60, -1e308, PAGE_MODE)
    expect(result.steps).toBe(WHEEL_MAX_STEPS_PER_EVENT)
    expect(Number.isFinite(result.remainder)).toBe(true)
    expect(Math.abs(result.remainder)).toBeLessThan(WHEEL_STEP_PX)
  })

  it('never throws, whatever it is given', () => {
    const values = [0, -0, 1, -1, 99, -99, 1e308, -1e308, Number.NaN, Number.POSITIVE_INFINITY]
    for (const remainder of values) {
      for (const delta of values) {
        for (const mode of [PIXEL_MODE, LINE_MODE, PAGE_MODE, 7]) {
          expect(() => accumulateWheelSteps(remainder, delta, mode)).not.toThrow()
        }
      }
    }
  })
})

describe('accumulateWheelSteps postconditions', () => {
  const cases: WheelStepResult[] = []
  for (const remainder of [-99, -60, -1, 0, 1, 60, 99]) {
    for (const delta of [-5000, -250, -120, -37, -1, 0, 1, 37, 120, 250, 5000]) {
      for (const mode of [PIXEL_MODE, LINE_MODE, PAGE_MODE]) {
        cases.push(accumulateWheelSteps(remainder, delta, mode))
      }
    }
  }

  it('returns a whole number of steps', () => {
    for (const result of cases) {
      expect(Number.isInteger(result.steps)).toBe(true)
    }
  })

  it('never exceeds the per-event cap', () => {
    for (const result of cases) {
      expect(Math.abs(result.steps)).toBeLessThanOrEqual(WHEEL_MAX_STEPS_PER_EVENT)
    }
  })

  it('returns a remainder strictly below the step threshold', () => {
    for (const result of cases) {
      expect(Math.abs(result.remainder)).toBeLessThan(WHEEL_STEP_PX)
    }
  })

  it('uses a single representation for zero', () => {
    // Object.is separates -0 from 0, so a stray -0 would surface here and in
    // any caller comparing the result against 0.
    for (const result of cases) {
      expect(Object.is(result.steps, -0)).toBe(false)
      expect(Object.is(result.remainder, -0)).toBe(false)
    }
  })
})

describe('accumulateWheelSteps purity', () => {
  // The module holds no state of its own: the caller owns the remainder, which
  // is what keeps App the single state owner for the shift.
  it('returns the same result for the same arguments, however often it is called', () => {
    const first = accumulateWheelSteps(60, -50, PIXEL_MODE)
    for (let i = 0; i < 5; i += 1) {
      expect(accumulateWheelSteps(60, -50, PIXEL_MODE)).toEqual(first)
    }
  })

  it('does not let one stream of events affect another', () => {
    const interleaved: number[] = []
    let a = 0
    let b = 0
    for (const delta of [-60, -60, -60, -60]) {
      const resultA = accumulateWheelSteps(a, delta, PIXEL_MODE)
      const resultB = accumulateWheelSteps(b, -delta, PIXEL_MODE)
      a = resultA.remainder
      b = resultB.remainder
      interleaved.push(resultA.steps, resultB.steps)
    }
    expect(interleaved).toEqual([0, 0, 1, -1, 0, 0, 1, -1])
  })
})
