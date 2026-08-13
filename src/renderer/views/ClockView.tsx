import { useEffect, useState } from 'react'
import { DAY_MS, formatClock, msIntoDay } from '../../shared/clock'
import { t } from '../../shared/i18n'
import type { ThemeId } from '../../shared/themes'
import { filledBlocks } from '../../shared/timer-logic'
import {
  PROGRESS_BLOCKS,
  type ClockFormat,
  type Language,
  type TimerSnapshot
} from '../../shared/types'
import { ThemePicker } from '../components/ThemePicker'

const PALETTE_SIZE = 3

interface ClockViewProps {
  snapshot: TimerSnapshot
  language: Language
  theme: ThemeId
  sessionsPerCycle: number
  clockFormat: ClockFormat
}

/**
 * Clock mode's normal-window view. It mirrors the timer view's layout — the
 * header, card, buttons, task line and theme picker all stay in place, only
 * disabled — while the card shows the time of day and how much of the
 * 24-hour day has passed. The pomodoro timer keeps running untouched in the
 * main process; the snapshot is only read for the labels the timer view
 * would show.
 */
export function ClockView({
  snapshot,
  language,
  theme,
  sessionsPerCycle,
  clockFormat
}: ClockViewProps): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())

  // Re-derive from the wall clock on every tick instead of accumulating
  // intervals, so a throttled or suspended renderer is correct again on its
  // first tick after waking. visibilitychange closes the gap where the
  // window becomes visible before the throttled interval fires.
  useEffect(() => {
    const sync = (): void => setNow(new Date())
    const id = window.setInterval(sync, 1000)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  // How much of the 24-hour day has passed, in the same 10-block strip the
  // timer uses for phase progress (empty at midnight, half full at noon).
  const dayBlocks = filledBlocks(
    DAY_MS - msIntoDay(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()),
    DAY_MS
  )

  const toggleLabel = snapshot.running
    ? t(language, 'timer.pause')
    : snapshot.fresh
      ? t(language, 'timer.start')
      : t(language, 'timer.resume')

  const taskName = snapshot.taskName || t(language, 'timer.defaultTask')

  return (
    <div className="timer">
      <div className="timer__header">
        <span className="timer__phase">{t(language, 'clock.mode')}</span>
        <span className="timer__session">
          {snapshot.session} / {sessionsPerCycle}
        </span>
      </div>
      <div className="timer__card">
        <div className={`timer__time ${clockFormat === 'hhmmss' ? 'timer__time--seconds' : ''}`}>
          {formatClock(now.getHours(), now.getMinutes(), now.getSeconds(), clockFormat)}
        </div>
        <div className="timer__blocks">
          {Array.from({ length: PROGRESS_BLOCKS }, (_, i) => (
            <span
              key={i}
              className="timer__block"
              style={{
                background:
                  i < dayBlocks ? `var(--palette-${(i % PALETTE_SIZE) + 1})` : 'var(--empty)'
              }}
            />
          ))}
        </div>
      </div>
      <div className="timer__buttons">
        <button type="button" className="btn btn--primary" disabled>
          {toggleLabel}
        </button>
        <button type="button" className="btn btn--secondary" disabled>
          {t(language, 'timer.skip')}
        </button>
      </div>
      <div className="timer__task">
        {t(language, 'timer.taskLabel')}: {taskName}
      </div>
      <ThemePicker language={language} theme={theme} disabled />
    </div>
  )
}
