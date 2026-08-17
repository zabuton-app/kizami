import { Fragment, useEffect, useState } from 'react'
import { buildClockRows, DAY_BLOCKS, DAY_MS, formatShiftLabel, msIntoDay } from '../../shared/clock'
import {
  CLOCK_TIMER_PRESETS,
  formatClockTimerTime,
  type ClockTimerPresetId,
  type ClockTimerSnapshot
} from '../../shared/clock-timer'
import { t } from '../../shared/i18n'
import type { ThemeId } from '../../shared/themes'
import { filledBlocks } from '../../shared/timer-logic'
import { TIMEZONE_OPTIONS, type SecondaryTimeZone } from '../../shared/timezones'
import { type ClockFormat, type Language, type TimerSnapshot } from '../../shared/types'
import type { ClockShiftProps } from '../App'
import { ThemePicker } from '../components/ThemePicker'

const PALETTE_SIZE = 3

interface ClockViewProps {
  snapshot: TimerSnapshot
  language: Language
  theme: ThemeId
  sessionsPerCycle: number
  clockFormat: ClockFormat
  secondaryTimeZone: SecondaryTimeZone
  clockTimer: ClockTimerSnapshot | null
  shift: ClockShiftProps
  onSelectTheme: (theme: ThemeId) => void
  onStartClockTimer: (preset: ClockTimerPresetId) => void
  onCancelClockTimer: () => void
  onDismissClockTimer: () => void
}

/**
 * Clock mode's normal-window view. It mirrors the timer view's layout — the
 * header, card, controls, task line and theme picker all stay in place —
 * while the card shows the time of day and how much of the 24-hour day has
 * passed. Where the timer view has start/skip, clock mode offers its own
 * countdown timer: preset buttons, and a remaining readout with a cancel
 * while one runs. The pomodoro timer keeps running untouched in the main
 * process; the snapshot is only read for the labels the timer view would
 * show.
 */
export function ClockView({
  snapshot,
  language,
  theme,
  sessionsPerCycle,
  clockFormat,
  secondaryTimeZone,
  clockTimer,
  shift,
  onSelectTheme,
  onStartClockTimer,
  onCancelClockTimer,
  onDismissClockTimer
}: ClockViewProps): React.JSX.Element {
  // Deliberately named for what it is: the *real* current time. It is the only
  // instant this view holds, and the day-progress blocks below must keep using
  // it (6.1, 6.3). The shifted instant the rows are drawn from is never a
  // variable here — it exists only inside `buildClockRows`, which derives it
  // from `realNow` on every render, so the two can never be mixed up.
  const [realNow, setRealNow] = useState(() => new Date())

  // Re-derive from the wall clock on every tick instead of accumulating
  // intervals, so a throttled or suspended renderer is correct again on its
  // first tick after waking. visibilitychange closes the gap where the
  // window becomes visible before the throttled interval fires.
  useEffect(() => {
    const sync = (): void => setRealNow(new Date())
    const id = window.setInterval(sync, 1000)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  // A city's label lives in the catalog and follows the interface language, so
  // it is resolved here and handed to the pure row builder as text — the same
  // convention `formatClockDate`'s weekday label follows. A zone that is not
  // in the catalog (a downgrade after an entry was removed) simply drops the
  // comparison row rather than rendering an unnamed one.
  const secondaryOption =
    secondaryTimeZone === null
      ? undefined
      : TIMEZONE_OPTIONS.find((option) => option.zone === secondaryTimeZone)

  const rows = buildClockRows({
    now: realNow,
    shiftHours: shift.shiftHours,
    format: clockFormat,
    homeLabel: t(language, 'clock.home'),
    secondary:
      secondaryOption === undefined
        ? null
        : { zone: secondaryOption.zone, label: t(language, secondaryOption.labelKey) }
  })

  // Empty while the clock is live, which is what removes both indications at
  // zero shift (4.3).
  const shiftLabel = formatShiftLabel(shift.shiftHours, t(language, 'clock.hourUnit'))

  // The card's accessible name: every row's place and time, plus the shift
  // amount when there is one (7.2). It is a name rather than a live region on
  // purpose — the time changes every second, and announcing that would make
  // the view unusable with a screen reader.
  const clockLabel = rows
    .map((row) => {
      if (row.label === null) {
        return row.time
      }
      // The offset is part of what the row says, so it belongs in the name a
      // screen reader reads rather than being visual-only.
      return row.offset === null
        ? `${row.label} ${row.time}`
        : `${row.label} ${row.time} ${row.offset}`
    })
    .concat(shiftLabel === '' ? [] : [shiftLabel])
    .join(', ')

  // How much of the 24-hour day has passed, in a twelve-block strip so a block
  // is exactly two hours (empty at midnight, half full at noon). Always the
  // real day, never the shifted one (6.1).
  const dayBlocks = filledBlocks(
    DAY_MS -
      msIntoDay(
        realNow.getHours(),
        realNow.getMinutes(),
        realNow.getSeconds(),
        realNow.getMilliseconds()
      ),
    DAY_MS,
    DAY_BLOCKS
  )

  const taskName = snapshot.taskName || t(language, 'timer.defaultTask')

  // Until the initial fetch lands the timer is shown as idle; the snapshot
  // subscription corrects this within the same frame in practice.
  const timerStatus = clockTimer?.status ?? 'idle'

  const rowsClass = [
    'timer__rows',
    rows.length > 1 ? 'timer__rows--pair' : '',
    shift.shiftHours === 0 ? '' : 'timer__rows--shifted'
  ]
    .filter((name) => name !== '')
    .join(' ')

  return (
    <div className="timer">
      <div className="timer__header">
        <span className="timer__phase">{t(language, 'clock.mode')}</span>
        <span className="timer__session">
          {snapshot.session} / {sessionsPerCycle}
        </span>
      </div>
      {/* The card is the shift surface: focusable so the keyboard reaches it
          (7.1), and grouped so its rows are announced as one thing (7.2). */}
      <div
        className="timer__card timer__card--clock"
        role="group"
        tabIndex={0}
        aria-label={clockLabel}
        onWheel={(event) => {
          // Ctrl+wheel is the app's UI zoom gesture (popup-window.ts), and a
          // trackpad pinch reaches the DOM the same way. Verified against the
          // built app: without this guard, zooming over the card also spun the
          // clock three hours.
          if (event.ctrlKey) return
          shift.onWheelShift(event.deltaY, event.deltaMode)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          // Stop the arrow keys from also scrolling the window behind them.
          event.preventDefault()
          shift.onKeyShift(event.key === 'ArrowUp' ? 1 : -1)
        }}
      >
        {/* The only live region in the view: the badge changes once per input
            rather than once per second, so announcing it costs nothing, while
            announcing the clock itself would talk over everything. It is
            rendered even when empty — a live region has to be in the document
            before the change for assistive technology to observe it — and the
            empty pill is collapsed to nothing by the stylesheet (4.3). */}
        <span className="timer__shift" aria-live="polite">
          {shiftLabel}
        </span>
        <div className={rowsClass}>
          {rows.map((row) => (
            // Fragments rather than a wrapper element: the two-row layout is a
            // grid over the labels and the times, so the cells have to be
            // direct children for the times to line up.
            <Fragment key={row.key}>
              {row.label !== null && <span className="timer__row-label">{row.label}</span>}
              <div className="timer__time">{row.time}</div>
              {/* Rendered on both rows so the grid stays rectangular and the
                  times keep lining up; the home row is the datum, so its cell
                  is empty rather than reading "0:00" against itself. */}
              {row.label !== null && <span className="timer__row-offset">{row.offset ?? ''}</span>}
            </Fragment>
          ))}
        </div>
        <div className="timer__blocks">
          {Array.from({ length: DAY_BLOCKS }, (_, i) => (
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
      {/* One row in every state. The timer view's height floor
          (WINDOW_MIN_CONTENT_HEIGHT) was measured with its single button row,
          so clock mode staying a single row is what keeps the theme picker on
          screen at the minimum window height; wrapping is only a safety net
          for a translation that outgrows the sizes in the stylesheet. */}
      <div className={timerStatus === 'idle' ? 'ctimer' : 'ctimer ctimer--active'}>
        {timerStatus === 'running' && clockTimer !== null && (
          <>
            {/* role="img" so the label is legal and exposed (a bare span is
                generic and may not be named); not a live region — it changes
                every second, and announcing that would talk over everything. */}
            <span
              className="ctimer__readout"
              role="img"
              aria-label={`${t(language, 'clockTimer.remainingLabel')} ${formatClockTimerTime(
                clockTimer.remainingSec
              )}`}
            >
              {formatClockTimerTime(clockTimer.remainingSec)}
            </span>
            <button
              type="button"
              className="btn ctimer__cancel"
              aria-label={t(language, 'clockTimer.cancel')}
              title={t(language, 'clockTimer.cancel')}
              onClick={onCancelClockTimer}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M1 1 L9 9 M9 1 L1 9" />
              </svg>
            </button>
          </>
        )}
        {/* Always in the document: a live region only announces changes to a
            region that already existed, so the span stays mounted and only
            its text appears on completion — which is once, and exactly what a
            screen-reader user needs in place of glancing at the window. Empty
            it is taken out of flow by the stylesheet. */}
        <span className="ctimer__done" role="status">
          {timerStatus === 'completed' ? t(language, 'clockTimer.done') : ''}
        </span>
        {/* Same 34px round-icon shape as the cancel button, so the completed
            row is never wider than the running one and both fit one line at
            every window width (a text button here pushed the row past the
            card width and wrapped the presets off the height floor). */}
        {timerStatus === 'completed' && (
          <button
            type="button"
            className="btn ctimer__dismiss"
            aria-label={t(language, 'clockTimer.dismiss')}
            title={t(language, 'clockTimer.dismiss')}
            onClick={onDismissClockTimer}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M1.5 6.5 L4.5 9.5 L10.5 2.5" />
            </svg>
          </button>
        )}
        {/* The presets stay visible while a timer runs so picking one simply
            replaces it — the main process swaps the countdown atomically.
            Beside a readout they compress to bare minute counts; the full
            label stays on the accessible name and the tooltip. */}
        <div
          className="ctimer__presets"
          role="group"
          aria-label={t(language, 'clockTimer.startLabel')}
        >
          {CLOCK_TIMER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="btn btn--secondary"
              aria-label={t(language, `clockTimer.preset.${preset.id}`)}
              title={
                timerStatus === 'idle' ? undefined : t(language, `clockTimer.preset.${preset.id}`)
              }
              onClick={() => onStartClockTimer(preset.id)}
            >
              {timerStatus === 'idle'
                ? t(language, `clockTimer.preset.${preset.id}`)
                : preset.minutes}
            </button>
          ))}
        </div>
      </div>
      <div className="timer__task">
        {t(language, 'timer.taskLabel')}: {taskName}
      </div>
      <ThemePicker language={language} theme={theme} onSelect={onSelectTheme} />
    </div>
  )
}
