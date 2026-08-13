import { useEffect, useState } from 'react'
import { DAY_MS, formatClock, msIntoDay } from '../../shared/clock'
import { t } from '../../shared/i18n'
import { filledBlocks } from '../../shared/timer-logic'
import { PROGRESS_BLOCKS, type ClockFormat, type Language } from '../../shared/types'

const PALETTE_SIZE = 3

interface MiniClockViewProps {
  clockFormat: ClockFormat
  language: Language
  onExitMini: () => void
}

/**
 * Clock mode's mini bar: the time of day, the day-progress blocks and the
 * expand button — no timer controls. Escape-to-hide and dragging are handled
 * by App/.app--mini, same as the timer bar.
 */
export function MiniClockView({
  clockFormat,
  language,
  onExitMini
}: MiniClockViewProps): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())

  // Same wall-clock derivation as ClockView: every tick reads the clock anew,
  // so the bar is right immediately after sleep or renderer throttling.
  useEffect(() => {
    const sync = (): void => setNow(new Date())
    const id = window.setInterval(sync, 1000)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])

  const dayBlocks = filledBlocks(
    DAY_MS - msIntoDay(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()),
    DAY_MS
  )

  const expandLabel = t(language, 'titlebar.expand')

  return (
    <div className="mini-bar">
      <div className="mini-bar__time">
        {formatClock(now.getHours(), now.getMinutes(), now.getSeconds(), clockFormat)}
      </div>
      <div className="mini-bar__blocks">
        {Array.from({ length: PROGRESS_BLOCKS }, (_, i) => (
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
