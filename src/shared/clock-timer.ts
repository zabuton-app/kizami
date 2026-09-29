/**
 * Ad-hoc countdown timer available in clock mode ("kitchen timer").
 * Pure state logic only: the main process owns the state via
 * ClockTimerEngine, and every function here takes `now` as an argument so
 * the sleep/catch-up behaviour is testable without clocks or Electron.
 * Deliberately independent of the pomodoro timer-logic module.
 */

export type ClockTimerPresetId = '5m' | '10m' | '15m' | '30m' | '60m'

export interface ClockTimerPreset {
  readonly id: ClockTimerPresetId
  readonly minutes: number
}

/** The fixed durations offered in clock mode; not user-editable. */
export const CLOCK_TIMER_PRESETS: readonly ClockTimerPreset[] = [
  { id: '5m', minutes: 5 },
  { id: '10m', minutes: 10 },
  { id: '15m', minutes: 15 },
  { id: '30m', minutes: 30 },
  { id: '60m', minutes: 60 }
]

/** Guard for the untrusted preset id crossing IPC from the renderer. */
export function isClockTimerPresetId(value: unknown): value is ClockTimerPresetId {
  return CLOCK_TIMER_PRESETS.some((preset) => preset.id === value)
}

export type ClockTimerStatus = 'idle' | 'running' | 'paused' | 'completed'

/**
 * Countdown state held by the main process only, never persisted.
 * While running, `endsAt` (epoch ms) is the sole source of truth; remaining
 * time is re-derived from it on every read, never accumulated. A paused timer
 * has no end yet, so it holds the frozen remaining time instead and gets a
 * fresh `endsAt` when it resumes.
 */
export type ClockTimerState =
  | { status: 'idle' }
  | { status: 'running'; durationMs: number; endsAt: number }
  | { status: 'paused'; durationMs: number; remainingMs: number }
  | { status: 'completed'; durationMs: number }

export const IDLE_CLOCK_TIMER: ClockTimerState = { status: 'idle' }

/** Display-ready snapshot pushed to the renderer over IPC. */
export interface ClockTimerSnapshot {
  status: ClockTimerStatus
  /** Whole seconds left, rounded up like the pomodoro snapshot; 0 while idle or completed. */
  remainingSec: number
  /** Duration of the current or just-finished timer in seconds; 0 while idle. */
  totalSec: number
}

/**
 * Start (or replace) the countdown. Any previous timer — running or
 * completed — is discarded, so at most one timer ever exists.
 */
export function startClockTimer(presetId: ClockTimerPresetId, now: number): ClockTimerState {
  const preset = CLOCK_TIMER_PRESETS.find((candidate) => candidate.id === presetId)
  if (preset === undefined) {
    // Unreachable through the typed API; kept so a bad cast cannot start an
    // undefined-length timer.
    return IDLE_CLOCK_TIMER
  }
  const durationMs = preset.minutes * 60_000
  return { status: 'running', durationMs, endsAt: now + durationMs }
}

export interface ClockTimerTickResult {
  state: ClockTimerState
  /**
   * True exactly once per timer: on the tick that crosses `endsAt`. This is
   * what bounds the completion notification to one, no matter how far past
   * the end the tick lands (system sleep, hidden window).
   */
  justCompleted: boolean
}

/** Advance the countdown to wall-clock time `now`. */
export function tickClockTimer(state: ClockTimerState, now: number): ClockTimerTickResult {
  if (state.status === 'running' && state.endsAt <= now) {
    return { state: { status: 'completed', durationMs: state.durationMs }, justCompleted: true }
  }
  return { state, justCompleted: false }
}

/**
 * Drop the timer entirely. From `running` this suppresses the pending
 * completion; from `completed` it doubles as dismiss (defensive alias).
 */
export function cancelClockTimer(): ClockTimerState {
  return IDLE_CLOCK_TIMER
}

/** Acknowledge the completed state; any other state is left untouched. */
export function dismissClockTimer(state: ClockTimerState): ClockTimerState {
  return state.status === 'completed' ? IDLE_CLOCK_TIMER : state
}

/**
 * Pause a running countdown or resume a paused one; any other state is left
 * untouched. Expects `state` to have been ticked to `now` first: a running
 * timer already past its end is returned as-is so the next tick completes it,
 * rather than being frozen at zero where it would never complete.
 */
export function toggleClockTimer(state: ClockTimerState, now: number): ClockTimerState {
  if (state.status === 'running') {
    const remainingMs = state.endsAt - now
    if (remainingMs <= 0) return state
    return { status: 'paused', durationMs: state.durationMs, remainingMs }
  }
  if (state.status === 'paused') {
    return { status: 'running', durationMs: state.durationMs, endsAt: now + state.remainingMs }
  }
  return state
}

/**
 * Wind the current timer — running, paused or completed — back to its full
 * duration and hold it paused, so it can be started again from the top.
 * An idle timer has no duration to return to and is left untouched.
 */
export function resetClockTimer(state: ClockTimerState): ClockTimerState {
  if (state.status === 'idle') return state
  return { status: 'paused', durationMs: state.durationMs, remainingMs: state.durationMs }
}

/**
 * Status of a possibly not-yet-fetched snapshot. Until the initial fetch
 * lands the timer is shown as idle; the snapshot subscription corrects this
 * within the same frame in practice.
 */
export function clockTimerStatusOf(snapshot: ClockTimerSnapshot | null): ClockTimerStatus {
  return snapshot?.status ?? 'idle'
}

/** Whether a timer is counting down or paused mid-way, i.e. has a readout to show. */
export function isClockTimerCounting(status: ClockTimerStatus): boolean {
  return status === 'running' || status === 'paused'
}

/**
 * Accessible name for a countdown readout: "<label> <time>", plus the paused
 * marker when the timer is held. Shared by the normal window and the mini bar.
 */
export function clockTimerReadoutLabel(
  snapshot: ClockTimerSnapshot,
  remainingLabel: string,
  pausedLabel: string
): string {
  const time = formatClockTimerTime(snapshot.remainingSec)
  return snapshot.status === 'paused'
    ? `${remainingLabel} ${time} ${pausedLabel}`
    : `${remainingLabel} ${time}`
}

/** Milliseconds left at `now`; clamped to zero, and zero while idle or completed. */
export function clockTimerRemainingMs(state: ClockTimerState, now: number): number {
  if (state.status === 'running') return Math.max(0, state.endsAt - now)
  if (state.status === 'paused') return state.remainingMs
  return 0
}

/** Derive the display snapshot for `now`. */
export function clockTimerSnapshot(state: ClockTimerState, now: number): ClockTimerSnapshot {
  return {
    status: state.status,
    remainingSec: Math.ceil(clockTimerRemainingMs(state, now) / 1000),
    totalSec: state.status === 'idle' ? 0 : Math.round(state.durationMs / 1000)
  }
}

/**
 * Format a countdown for display: `mm:ss` under an hour, `h:mm:ss` from an
 * hour up. The hour digit is unpadded — this reads as a duration, not as a
 * time of day.
 */
export function formatClockTimerTime(remainingSec: number): string {
  const clamped = Math.max(0, remainingSec)
  const h = Math.floor(clamped / 3600)
  const m = Math.floor((clamped % 3600) / 60)
  const s = clamped % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
