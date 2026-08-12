import { t } from '../../shared/i18n'
import { displaySec, formatTime } from '../../shared/timer-logic'
import type { ThemeId } from '../../shared/themes'
import {
  PROGRESS_BLOCKS,
  type Language,
  type TimeDisplayMode,
  type TimerSnapshot
} from '../../shared/types'
import { ThemePicker } from '../components/ThemePicker'

const PALETTE_SIZE = 3

interface TimerViewProps {
  snapshot: TimerSnapshot
  language: Language
  theme: ThemeId
  timeDisplay: TimeDisplayMode
  sessionsPerCycle: number
  onToggle: () => void
  onSkip: () => void
  onSelectTheme: (theme: ThemeId) => void
}

const PHASE_KEY = {
  work: 'phase.work',
  shortBreak: 'phase.shortBreak',
  longBreak: 'phase.longBreak'
} as const

export function TimerView({
  snapshot,
  language,
  theme,
  timeDisplay,
  sessionsPerCycle,
  onToggle,
  onSkip,
  onSelectTheme
}: TimerViewProps): React.JSX.Element {
  const toggleLabel = snapshot.running
    ? t(language, 'timer.pause')
    : snapshot.fresh
      ? t(language, 'timer.start')
      : t(language, 'timer.resume')

  const taskName = snapshot.taskName || t(language, 'timer.defaultTask')

  return (
    <div className="timer">
      <div className="timer__header">
        <span className="timer__phase">{t(language, PHASE_KEY[snapshot.phase])}</span>
        <span className="timer__session">
          {snapshot.session} / {sessionsPerCycle}
        </span>
      </div>
      <div className="timer__card">
        <div className="timer__time">
          {formatTime(displaySec(snapshot.remainingSec, snapshot.totalSec, timeDisplay))}
        </div>
        <div className="timer__blocks">
          {Array.from({ length: PROGRESS_BLOCKS }, (_, i) => (
            <span
              key={i}
              className="timer__block"
              style={{
                background:
                  i < snapshot.filledBlocks
                    ? `var(--palette-${(i % PALETTE_SIZE) + 1})`
                    : 'var(--empty)'
              }}
            />
          ))}
        </div>
      </div>
      <div className="timer__buttons">
        <button type="button" className="btn btn--primary" onClick={onToggle}>
          {toggleLabel}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onSkip}>
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
