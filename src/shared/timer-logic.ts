import {
  PROGRESS_BLOCKS,
  SESSIONS_PER_CYCLE,
  type Phase,
  type Settings,
  type TimeDisplayMode,
  type TimerState
} from './types'

export interface PhaseTransition {
  from: Phase
  to: Phase
}

export interface TickResult {
  state: TimerState
  /** Phase changes that occurred during this tick, in order (may be several after sleep). */
  transitions: PhaseTransition[]
}

export function phaseDurationMs(phase: Phase, settings: Settings): number {
  const minutes =
    phase === 'work'
      ? settings.workMinutes
      : phase === 'shortBreak'
        ? settings.shortBreakMinutes
        : settings.longBreakMinutes
  return minutes * 60_000
}

export function createInitialState(settings: Settings): TimerState {
  const duration = phaseDurationMs('work', settings)
  return {
    phase: 'work',
    session: 1,
    running: false,
    started: false,
    endsAt: null,
    remainingMs: duration,
    totalMs: duration
  }
}

/** True while the current phase has never been started. */
export function isFresh(state: TimerState): boolean {
  return !state.started
}

function nextPhaseOf(state: TimerState): { phase: Phase; session: number } {
  if (state.phase === 'work') {
    return {
      phase: state.session >= SESSIONS_PER_CYCLE ? 'longBreak' : 'shortBreak',
      session: state.session
    }
  }
  return {
    phase: 'work',
    session: state.phase === 'longBreak' ? 1 : state.session + 1
  }
}

/**
 * Move to the next phase as of wall-clock time `at`.
 * With autoStart the new phase starts counting from `at`; otherwise it waits.
 */
function enterNextPhase(state: TimerState, settings: Settings, at: number): TimerState {
  const next = nextPhaseOf(state)
  const duration = phaseDurationMs(next.phase, settings)
  const running = settings.autoStart
  return {
    phase: next.phase,
    session: next.session,
    running,
    started: running,
    endsAt: running ? at + duration : null,
    remainingMs: duration,
    totalMs: duration
  }
}

/** Start / pause / resume. */
export function toggle(state: TimerState, now: number): TimerState {
  if (state.running) {
    return {
      ...state,
      running: false,
      endsAt: null,
      remainingMs: Math.max(0, (state.endsAt ?? now) - now)
    }
  }
  return {
    ...state,
    running: true,
    started: true,
    endsAt: now + state.remainingMs
  }
}

/** Skip the rest of the current phase and enter the next one immediately. */
export function skip(state: TimerState, settings: Settings, now: number): TickResult {
  const from = state.phase
  const next = enterNextPhase(state, settings, now)
  return { state: next, transitions: [{ from, to: next.phase }] }
}

/**
 * Advance the timer to wall-clock time `now`.
 * Catches up across multiple phases when a long time has passed (e.g. system sleep):
 * each elapsed phase is entered at its actual boundary time, not at `now`.
 */
export function tick(state: TimerState, settings: Settings, now: number): TickResult {
  const transitions: PhaseTransition[] = []
  let current = state
  while (current.running && current.endsAt !== null && current.endsAt <= now) {
    const boundary = current.endsAt
    const from = current.phase
    current = enterNextPhase(current, settings, boundary)
    transitions.push({ from, to: current.phase })
    if (!current.running) break
  }
  return { state: current, transitions }
}

export function remainingMsAt(state: TimerState, now: number): number {
  return state.running && state.endsAt !== null
    ? Math.max(0, state.endsAt - now)
    : state.remainingMs
}

export function filledBlocks(remainingMs: number, totalMs: number): number {
  if (totalMs <= 0) return 0
  const ratio = 1 - remainingMs / totalMs
  return Math.min(PROGRESS_BLOCKS, Math.max(0, Math.round(ratio * PROGRESS_BLOCKS)))
}

/**
 * Seconds to show for the current phase, per the user's chosen direction.
 * `remainingSec` is rounded up by the engine, so the elapsed side comes out
 * rounded down — which keeps `remaining + elapsed === totalSec` at every tick.
 */
export function displaySec(remainingSec: number, totalSec: number, mode: TimeDisplayMode): number {
  const max = Math.max(0, totalSec)
  const value = mode === 'elapsed' ? max - remainingSec : remainingSec
  return Math.min(max, Math.max(0, value))
}

export function formatTime(remainingSec: number): string {
  const m = String(Math.floor(remainingSec / 60)).padStart(2, '0')
  const s = String(remainingSec % 60).padStart(2, '0')
  return `${m}:${s}`
}
