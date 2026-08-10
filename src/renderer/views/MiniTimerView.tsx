import { t } from '../../shared/i18n'
import { formatTime } from '../../shared/timer-logic'
import { PROGRESS_BLOCKS, type Language, type TimerSnapshot } from '../../shared/types'

const PALETTE_SIZE = 3

const PHASE_KEY = {
  work: 'phase.work',
  shortBreak: 'phase.shortBreak',
  longBreak: 'phase.longBreak'
} as const

interface MiniTimerViewProps {
  snapshot: TimerSnapshot
  language: Language
  onToggle: () => void
  onSkip: () => void
  onExitMini: () => void
}

export function MiniTimerView({
  snapshot,
  language,
  onToggle,
  onSkip,
  onExitMini
}: MiniTimerViewProps): React.JSX.Element {
  const toggleLabel = snapshot.running
    ? t(language, 'timer.pause')
    : snapshot.fresh
      ? t(language, 'timer.start')
      : t(language, 'timer.resume')

  const skipLabel = t(language, 'timer.skip')
  const expandLabel = t(language, 'titlebar.expand')
  const phaseLabel = t(language, PHASE_KEY[snapshot.phase])

  return (
    <div className="mini-bar">
      {/* The dot conveys the phase by colour alone, so name it for screen
          readers — and because the two break phases share one colour. */}
      <span
        className="mini-bar__dot"
        role="img"
        aria-label={phaseLabel}
        title={phaseLabel}
        style={{ background: snapshot.phase === 'work' ? 'var(--primary)' : 'var(--badge)' }}
      />
      <div className="mini-bar__time">{formatTime(snapshot.remainingSec)}</div>
      <div className="mini-bar__blocks">
        {Array.from({ length: PROGRESS_BLOCKS }, (_, i) => (
          <span
            key={i}
            className="mini-bar__block"
            style={{
              background:
                i < snapshot.filledBlocks
                  ? `var(--palette-${(i % PALETTE_SIZE) + 1})`
                  : 'var(--empty)'
            }}
          />
        ))}
      </div>
      <button
        type="button"
        className="mini-bar__toggle"
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={onToggle}
      >
        {snapshot.running ? (
          <span className="mini-bar__pause">
            <span className="mini-bar__pause-bar" />
            <span className="mini-bar__pause-bar" />
          </span>
        ) : (
          <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden="true">
            <polygon points="1,0 11,6 1,12" fill="currentColor" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="mini-bar__icon-btn"
        aria-label={skipLabel}
        title={skipLabel}
        onClick={onSkip}
      >
        <svg width="10" height="8" viewBox="0 0 10 8" aria-hidden="true">
          <polygon points="0,0 4,4 0,8" fill="currentColor" />
          <polygon points="5,0 9,4 5,8" fill="currentColor" />
        </svg>
      </button>
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
