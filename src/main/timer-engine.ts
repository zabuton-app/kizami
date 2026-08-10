import { EventEmitter } from 'node:events'
import {
  createInitialState,
  filledBlocks,
  isFresh,
  phaseDurationMs,
  remainingMsAt,
  skip,
  tick,
  toggle,
  type PhaseTransition
} from '../shared/timer-logic'
import type { Settings, TimerSnapshot, TimerState } from '../shared/types'

export interface TimerEngineEvents {
  /** Emitted whenever the observable state may have changed. */
  update: []
  /** Emitted for a skip or the latest phase reached after a natural catch-up. */
  transition: [PhaseTransition]
}

/**
 * Wall-clock based pomodoro engine living in the main process.
 * A 1s interval only *observes* time passing; the source of truth is `endsAt`,
 * so hidden windows, blocked event loops and system sleep never lose time.
 */
export class TimerEngine extends EventEmitter<TimerEngineEvents> {
  private state: TimerState
  private interval: NodeJS.Timeout | null = null

  constructor(private readonly getSettings: () => Settings) {
    super()
    this.state = createInitialState(getSettings())
  }

  start(): void {
    if (this.interval) return
    this.interval = setInterval(() => this.advance(), 1000)
    // Don't keep the process alive just for the tick (app lifecycle owns that).
    this.interval.unref?.()
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  private advance(): void {
    const result = tick(this.state, this.getSettings(), Date.now())
    this.state = result.state
    // A machine may sleep through many auto-started phases. The state catches
    // up through all of them, but notifying for every historical transition
    // would flood the desktop on wake. Only the current/latest transition is
    // actionable to the user.
    const latestTransition = result.transitions.at(-1)
    if (latestTransition) {
      this.emit('transition', latestTransition)
    }
    this.emit('update')
  }

  toggle(): TimerSnapshot {
    // Catch up first so a resume after sleep transitions before toggling.
    this.advance()
    this.state = toggle(this.state, Date.now())
    this.emit('update')
    return this.snapshot()
  }

  skip(): TimerSnapshot {
    const result = skip(this.state, this.getSettings(), Date.now())
    this.state = result.state
    for (const transition of result.transitions) {
      this.emit('transition', transition)
    }
    this.emit('update')
    return this.snapshot()
  }

  /**
   * React to a settings change: a phase that has not started yet picks up the
   * new duration immediately; a started phase keeps its remaining time
   * (new durations apply from the next phase).
   */
  applySettingsChange(next: Settings): void {
    if (isFresh(this.state)) {
      const duration = phaseDurationMs(this.state.phase, next)
      this.state = { ...this.state, remainingMs: duration, totalMs: duration }
    }
    this.emit('update')
  }

  /**
   * Development aid for the documentation captures (tools/demo-capture): start
   * the current phase as if `ms` of it had already passed, by backdating the
   * start of the countdown.
   */
  simulateElapsed(ms: number): void {
    if (!this.state.running) {
      this.state = toggle(this.state, Date.now() - ms)
      this.emit('update')
    }
  }

  isRunning(): boolean {
    return this.state.running
  }

  currentPhase(): TimerState['phase'] {
    return this.state.phase
  }

  snapshot(): TimerSnapshot {
    const now = Date.now()
    const settings = this.getSettings()
    const remainingMs = remainingMsAt(this.state, now)
    return {
      phase: this.state.phase,
      session: this.state.session,
      running: this.state.running,
      fresh: isFresh(this.state),
      remainingSec: Math.ceil(remainingMs / 1000),
      totalSec: Math.round(this.state.totalMs / 1000),
      filledBlocks: filledBlocks(remainingMs, this.state.totalMs),
      taskName: settings.taskName,
      language: settings.language
    }
  }
}
