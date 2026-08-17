import { EventEmitter } from 'node:events'
import {
  cancelClockTimer,
  clockTimerSnapshot,
  dismissClockTimer,
  IDLE_CLOCK_TIMER,
  startClockTimer,
  tickClockTimer,
  type ClockTimerPresetId,
  type ClockTimerSnapshot,
  type ClockTimerState
} from '../shared/clock-timer'

export interface ClockTimerEngineEvents {
  /** Emitted whenever the observable state may have changed. */
  update: []
  /** Emitted exactly once per timer, on the tick that reaches zero. */
  completed: []
}

/**
 * Wall-clock based countdown engine for clock mode, living in the main
 * process so the timer survives window hiding and can notify on completion.
 * Same shape as TimerEngine: the 1s interval only *observes* time passing —
 * the source of truth is `endsAt` — but here the interval runs only while a
 * timer is actually counting, so an unused feature costs nothing.
 * Deliberately holds no reference to the pomodoro engine.
 */
export class ClockTimerEngine extends EventEmitter<ClockTimerEngineEvents> {
  private state: ClockTimerState = IDLE_CLOCK_TIMER
  private interval: NodeJS.Timeout | null = null

  start(presetId: ClockTimerPresetId): ClockTimerSnapshot {
    this.state = startClockTimer(presetId, Date.now())
    this.startTicking()
    this.emit('update')
    return this.snapshot()
  }

  cancel(): ClockTimerSnapshot {
    this.state = cancelClockTimer()
    this.stopTicking()
    this.emit('update')
    return this.snapshot()
  }

  dismiss(): ClockTimerSnapshot {
    this.state = dismissClockTimer(this.state)
    this.emit('update')
    return this.snapshot()
  }

  /** Stop the tick for shutdown; `unref()` alone does not cancel it. */
  stop(): void {
    this.stopTicking()
  }

  snapshot(): ClockTimerSnapshot {
    // Resolve an overdue timer before reporting, so a snapshot taken right
    // after wake (e.g. the window-show re-sync) never shows a stale positive
    // remaining time. The completion side effects still fire exactly once.
    this.advance()
    return clockTimerSnapshot(this.state, Date.now())
  }

  private startTicking(): void {
    if (this.interval) return
    this.interval = setInterval(() => {
      this.advance()
      this.emit('update')
    }, 1000)
    // Don't keep the process alive just for the tick (app lifecycle owns that).
    this.interval.unref?.()
  }

  private stopTicking(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  private advance(): void {
    const result = tickClockTimer(this.state, Date.now())
    this.state = result.state
    if (result.justCompleted) {
      // The countdown is over; the interval has nothing left to observe.
      this.stopTicking()
      this.emit('completed')
    }
  }
}
