export const REMAP_SETTLE_MS = 1000
export const TRANSITION_SETTLE_MS = 500
export const NUDGE_RESTORE_MS = 100

/**
 * Tracks the short-lived guards used while Wayland applies popup size changes.
 *
 * Keeping the deadlines and transition generation here makes their semantics
 * testable without Electron or a compositor. Callers provide `now` so tests do
 * not depend on fake timers and runtime code can take one consistent timestamp
 * per event.
 */
export class PopupTransitionState {
  private remapSettleUntil = 0
  private transitionSettleUntil = 0
  private transitionGeneration = 0
  private nudgeUntil = 0

  clearRemap(): void {
    this.remapSettleUntil = 0
  }

  armRemap(now: number): void {
    this.remapSettleUntil = now + REMAP_SETTLE_MS
  }

  /** Consume the one-shot remap correction when it is still active. */
  consumeRemap(now: number): boolean {
    if (now >= this.remapSettleUntil) return false
    this.remapSettleUntil = 0
    return true
  }

  /** Start a new mini-mode transition and invalidate every older callback. */
  beginTransition(now: number): number {
    this.transitionGeneration += 1
    this.clearRemap()
    this.finishNudge()
    this.rearmTransition(now)
    return this.transitionGeneration
  }

  rearmTransition(now: number): void {
    this.transitionSettleUntil = now + TRANSITION_SETTLE_MS
  }

  isTransitioning(now: number): boolean {
    return now < this.transitionSettleUntil
  }

  isCurrent(generation: number): boolean {
    return generation === this.transitionGeneration
  }

  beginNudge(now: number): void {
    this.nudgeUntil = now + TRANSITION_SETTLE_MS
  }

  finishNudge(): void {
    this.nudgeUntil = 0
  }

  isNudging(now: number): boolean {
    return now < this.nudgeUntil
  }
}
