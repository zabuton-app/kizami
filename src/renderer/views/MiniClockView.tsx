import { useEffect, useState } from 'react'
import {
  buildClockRows,
  DAY_BLOCKS,
  DAY_MS,
  formatClockDate,
  formatShiftLabel,
  msIntoDay,
  WEEKDAY_KEYS
} from '../../shared/clock'
import { t } from '../../shared/i18n'
import { filledBlocks } from '../../shared/timer-logic'
import { TIMEZONE_OPTIONS, type SecondaryTimeZone } from '../../shared/timezones'
import { type ClockFormat, type Language } from '../../shared/types'
import type { ClockShiftProps } from '../App'

const PALETTE_SIZE = 3

interface MiniClockViewProps {
  clockFormat: ClockFormat
  language: Language
  secondaryTimeZone: SecondaryTimeZone
  shift: ClockShiftProps
  onExitMini: () => void
}

/**
 * Clock mode's mini bar: the clock rows, the day-progress blocks, the date and
 * the expand button — no timer controls. Escape-to-expand and dragging are
 * handled by App/.app--mini, same as the timer bar.
 *
 * The bar is 380x58 at zoom 1, so a second zone has no room beside the first.
 * Each row is drawn as a stacked cell instead — a small label line above the
 * time — which costs width only up to the wider of a zone's own label and its
 * own time, and gives the shift amount somewhere to live without adding an
 * element of its own (2.6, 4.4).
 */
export function MiniClockView({
  clockFormat,
  language,
  secondaryTimeZone,
  shift,
  onExitMini
}: MiniClockViewProps): React.JSX.Element {
  // The *real* current time, and the only instant this view holds. The date
  // and the day-progress blocks below must keep using it (6.1, 6.2); the
  // shifted instant the rows are drawn from exists only inside
  // `buildClockRows`, so the two can never be mixed up.
  const [realNow, setRealNow] = useState(() => new Date())

  // Same wall-clock derivation as ClockView: every tick reads the clock anew,
  // so the bar is right immediately after sleep or renderer throttling.
  useEffect(() => {
    const sync = (): void => setRealNow(new Date())
    const id = window.setInterval(sync, 1000)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  // Same lookup as ClockView: the row builder takes label text rather than
  // resolving messages itself, and a zone missing from the catalog (a
  // downgrade after an entry was removed) drops the comparison cell rather
  // than rendering an unnamed one.
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

  // The clock area's accessible name: every cell's place and time, plus the
  // shift amount when there is one (7.2). A name rather than a live region on
  // purpose — the time changes every second, and announcing that would make
  // the bar unusable with a screen reader.
  const clockLabel = rows
    .map((row) => (row.label === null ? row.time : `${row.label} ${row.time}`))
    .concat(shiftLabel === '' ? [] : [shiftLabel])
    .join(', ')

  // How much of the 24-hour day has passed. Always the real day, never the
  // shifted one (6.1).
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

  const clockClass = [
    'mini-bar__clock',
    rows.length > 1 ? 'mini-bar__clock--pair' : '',
    shift.shiftHours === 0 ? '' : 'mini-bar__clock--shifted'
  ]
    .filter((name) => name !== '')
    .join(' ')

  const expandLabel = t(language, 'titlebar.expand')

  return (
    <div className="mini-bar">
      {/* The clock area is the shift surface: focusable so the keyboard reaches
          it (7.1), and grouped so its cells are announced as one thing (7.2).
          It also opts out of the bar's drag region, or the compositor would
          swallow the wheel events before they reached the DOM (3.6); the rest
          of the bar stays draggable so the window can still be moved. */}
      <div
        className={clockClass}
        role="group"
        tabIndex={0}
        aria-label={clockLabel}
        onWheel={(event) => {
          // Ctrl+wheel is the app's UI zoom gesture (popup-window.ts), and a
          // trackpad pinch reaches the DOM the same way. Without this guard,
          // zooming over the bar would also spin the clock.
          if (event.ctrlKey) return
          shift.onWheelShift(event.deltaY, event.deltaMode)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          // Stop the arrow keys from also scrolling the window behind them.
          // Only these two are consumed, so App's Escape binding — which skips
          // an already-handled event — still leaves the bar.
          event.preventDefault()
          shift.onKeyShift(event.key === 'ArrowUp' ? 1 : -1)
        }}
      >
        {rows.map((row) => (
          <div key={row.key} className="mini-bar__cell">
            <span className="mini-bar__cell-label">
              {row.label}
              {/* The only live region in the bar: it changes once per input
                  rather than once per second, so announcing it costs nothing,
                  while announcing the clock itself would talk over everything.
                  It is rendered even when empty — a live region has to be in
                  the document before the change for assistive technology to
                  observe it — and an empty one is collapsed to nothing by the
                  stylesheet, which is what keeps the unset-zone bar identical
                  to 007's (4.3). */}
              {row.key === 'home' && (
                <span className="mini-bar__shift" aria-live="polite">
                  {shiftLabel}
                </span>
              )}
            </span>
            <span className="mini-bar__time">{row.time}</span>
          </div>
        ))}
      </div>
      <div className="mini-bar__blocks">
        {Array.from({ length: DAY_BLOCKS }, (_, i) => (
          <span
            key={i}
            className="mini-bar__block"
            style={{
              background:
                i < dayBlocks ? `var(--palette-${(i % PALETTE_SIZE) + 1})` : 'var(--empty)'
            }}
          />
        ))}
      </div>
      <span className="mini-bar__date">
        {formatClockDate(
          realNow.getMonth() + 1,
          realNow.getDate(),
          t(language, WEEKDAY_KEYS[realNow.getDay()]),
          language
        )}
      </span>
      <button
        type="button"
        className="mini-bar__icon-btn"
        aria-label={expandLabel}
        title={expandLabel}
        onClick={onExitMini}
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
          <path d="M1 6 V9 H4 M9 4 V1 H6" />
        </svg>
      </button>
    </div>
  )
}
