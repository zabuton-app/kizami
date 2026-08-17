import { Fragment, useEffect, useState } from 'react'
import { buildClockRows, DAY_BLOCKS, DAY_MS, formatShiftLabel, msIntoDay } from '../../shared/clock'
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
  shift: ClockShiftProps
  onSelectTheme: (theme: ThemeId) => void
}

/**
 * Clock mode's normal-window view. It mirrors the timer view's layout — the
 * header, card, buttons, task line and theme picker all stay in place, with
 * the timer controls disabled but the theme picker still live — while the
 * card shows the time of day and how much of the 24-hour day has passed.
 * The pomodoro timer keeps running untouched in the main process; the
 * snapshot is only read for the labels the timer view would show.
 */
export function ClockView({
  snapshot,
  language,
  theme,
  sessionsPerCycle,
  clockFormat,
  secondaryTimeZone,
  shift,
  onSelectTheme
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

  const toggleLabel = snapshot.running
    ? t(language, 'timer.pause')
    : snapshot.fresh
      ? t(language, 'timer.start')
      : t(language, 'timer.resume')

  const taskName = snapshot.taskName || t(language, 'timer.defaultTask')

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
      <ThemePicker language={language} theme={theme} onSelect={onSelectTheme} />
    </div>
  )
}
