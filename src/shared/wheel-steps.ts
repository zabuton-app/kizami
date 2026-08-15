/** Normalized scroll distance that moves the clock by one hour. */
export const WHEEL_STEP_PX = 100

/** Most hours one wheel event may move, so a momentum fling cannot leap the range. */
export const WHEEL_MAX_STEPS_PER_EVENT = 3

/** Pixels one line stands for in `deltaMode` 1, roughly one line of body text. */
const LINE_PX = 16

/** Pixels one page stands for in `deltaMode` 2; a page is deliberately one step. */
const PAGE_PX = 100

export interface WheelStepResult {
  /** Whole hours to move: positive is forward, produced by scrolling upward. */
  readonly steps: number
  /** Sub-step distance the caller carries into the next event. */
  readonly remainder: number
}

/**
 * Pixels a `deltaMode` unit is worth. The DOM defines 0 (pixel), 1 (line) and
 * 2 (page); anything else is read as pixels so an unfamiliar mode degrades to
 * a plausible scroll rather than to nothing at all.
 */
function deltaScale(deltaMode: number): number {
  if (deltaMode === 1) {
    return LINE_PX
  }
  if (deltaMode === 2) {
    return PAGE_PX
  }
  return 1
}

/** Collapse -0, so a step-free result has a single representation for callers. */
function collapseZero(value: number): number {
  return value === 0 ? 0 : value
}

/**
 * Turn one wheel event into whole hour steps, carrying what is left over.
 *
 * A mouse notch arrives as a single delta of about one threshold, while a
 * trackpad emits a stream of small ones; this is the only place that
 * difference is interpreted. The module holds no state — the caller passes the
 * running remainder and gets the new one back — which is what keeps the shift
 * owned in one place.
 *
 * Scrolling upward is forward, and the DOM reports upward as a *negative*
 * `deltaY`, so the sign is inverted exactly once, here.
 */
export function accumulateWheelSteps(
  remainder: number,
  deltaY: number,
  deltaMode: number
): WheelStepResult {
  if (!Number.isFinite(remainder)) {
    // The remainder is caller-held, so a broken one came from outside. Drop it
    // and let the next event start a gesture from a clean zero.
    return { steps: 0, remainder: 0 }
  }
  if (!Number.isFinite(deltaY)) {
    // Ignore a stray delta rather than let it poison a gesture in progress.
    return { steps: 0, remainder }
  }

  const movement = -deltaY * deltaScale(deltaMode)
  // A reversal starts fresh: keeping the old remainder would make the user
  // scroll off their previous progress before the clock moved the other way.
  // The product is negative only when both are non-zero with opposite signs,
  // so a zero delta leaves the gesture alone.
  const reversed = movement * remainder < 0
  const total = (reversed ? 0 : remainder) + movement

  // Excess steps beyond the cap are discarded, not banked, so a fling moves by
  // the cap and no further.
  const whole = Math.trunc(total / WHEEL_STEP_PX)
  const steps = Math.min(WHEEL_MAX_STEPS_PER_EVENT, Math.max(-WHEEL_MAX_STEPS_PER_EVENT, whole))
  // Scaling an absurd delta can overflow to infinity, where there is no
  // meaningful leftover to keep.
  const rest = Number.isFinite(total) ? total % WHEEL_STEP_PX : 0

  return { steps: collapseZero(steps), remainder: collapseZero(rest) }
}
