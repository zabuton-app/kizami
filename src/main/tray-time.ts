import { displaySec, filledBlocks, formatTime } from '../shared/timer-logic'
import type { Settings, TimerSnapshot } from '../shared/types'

/**
 * Number of distinct positions the tray ring can take over one phase. The
 * ring is only a couple of pixels wide, so redrawing it every second would
 * change nothing visible while rebuilding the tray image each tick.
 */
export const TRAY_RING_STEPS = 60

export interface TrayTime {
  /** Time shown with the tray icon, following the popup's time display. */
  text: string
  /** Elapsed fraction of the phase, snapped to one of TRAY_RING_STEPS. */
  progress: number
}

type TrayTimeInput = Pick<TimerSnapshot, 'fresh' | 'remainingSec' | 'totalSec'>

/**
 * What the tray shows of the running phase, or null when it shows nothing: the
 * user turned it off, or the phase has not been started yet (an idle timer
 * reads as the plain icon rather than a frozen "25:00").
 */
export function trayTime(
  snapshot: TrayTimeInput,
  settings: Pick<Settings, 'trayTime' | 'timeDisplay'>
): TrayTime | null {
  if (!settings.trayTime || snapshot.fresh) return null
  const { remainingSec, totalSec } = snapshot
  return {
    text: formatTime(displaySec(remainingSec, totalSec, settings.timeDisplay)),
    progress: filledBlocks(remainingSec, totalSec, TRAY_RING_STEPS) / TRAY_RING_STEPS
  }
}
