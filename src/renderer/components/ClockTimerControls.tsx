import {
  CLOCK_TIMER_PRESETS,
  clockTimerReadoutLabel,
  clockTimerStatusOf,
  formatClockTimerTime,
  isClockTimerCounting,
  type ClockTimerPresetId,
  type ClockTimerSnapshot
} from '../../shared/clock-timer'
import { t } from '../../shared/i18n'
import type { Language } from '../../shared/types'
import { SHORTCUT_KEYS, withShortcutHint } from '../shortcuts'

/**
 * Clock mode's countdown controls, shared by the normal window and the mini
 * bar so both offer the same actions with the same names. The variant picks
 * the class names (each view's stylesheet section sizes them) and, for the
 * presets, whether the full label is available at all.
 */
type Variant = 'window' | 'mini'

const CLASSES = {
  window: {
    controls: 'ctimer__controls',
    controlsIdle: 'ctimer__controls ctimer__controls--idle',
    readout: 'ctimer__readout',
    readoutPaused: 'ctimer__readout--paused',
    toggle: 'btn ctimer__icon ctimer__icon--primary',
    icon: 'btn ctimer__icon',
    done: 'ctimer__done',
    dismiss: 'btn ctimer__icon ctimer__icon--primary',
    presets: 'ctimer__presets',
    preset: 'btn btn--secondary'
  },
  mini: {
    controls: 'mini-bar__controls',
    controlsIdle: 'mini-bar__controls mini-bar__controls--idle',
    readout: 'mini-bar__readout',
    readoutPaused: 'mini-bar__readout--paused',
    toggle: 'mini-bar__toggle mini-bar__toggle--small',
    icon: 'mini-bar__icon-btn',
    done: 'mini-bar__ctimer mini-bar__ctimer--done',
    dismiss: 'mini-bar__toggle mini-bar__toggle--small',
    presets: 'mini-bar__presets',
    preset: 'mini-bar__icon-btn mini-bar__preset'
  }
} as const

interface ClockTimerControlsProps {
  variant: Variant
  clockTimer: ClockTimerSnapshot | null
  language: Language
  onToggle: () => void
  onReset: () => void
  onCancel: () => void
  onDismiss: () => void
}

/**
 * The running timer's row: remaining time, pause/resume, reset and cancel —
 * or, once it has finished, the done badge and its acknowledgement.
 */
export function ClockTimerControls({
  variant,
  clockTimer,
  language,
  onToggle,
  onReset,
  onCancel,
  onDismiss
}: ClockTimerControlsProps): React.JSX.Element {
  const classes = CLASSES[variant]
  const status = clockTimerStatusOf(clockTimer)
  const toggleLabel = withShortcutHint(
    t(language, status === 'paused' ? 'clockTimer.resume' : 'clockTimer.pause'),
    SHORTCUT_KEYS.toggle
  )
  const resetLabel = withShortcutHint(t(language, 'clockTimer.reset'), SHORTCUT_KEYS.reset)
  const cancelLabel = t(language, 'clockTimer.cancel')
  const dismissLabel = t(language, 'clockTimer.dismiss')

  return (
    // Idle, the row holds only the empty live region and the stylesheet
    // collapses it, so it adds no height to the layout around it.
    <div className={status === 'idle' ? classes.controlsIdle : classes.controls}>
      {isClockTimerCounting(status) && clockTimer !== null && (
        <>
          {/* role="img" so the label is legal and exposed (a bare span is
              generic and may not be named); not a live region — it changes
              every second, and announcing that would talk over everything.
              Paused, it is dimmed and says so in its name. */}
          <span
            className={
              status === 'paused' ? `${classes.readout} ${classes.readoutPaused}` : classes.readout
            }
            role="img"
            aria-label={clockTimerReadoutLabel(
              clockTimer,
              t(language, 'clockTimer.remainingLabel'),
              t(language, 'clockTimer.paused')
            )}
          >
            {formatClockTimerTime(clockTimer.remainingSec)}
          </span>
          <button
            type="button"
            className={classes.toggle}
            aria-label={toggleLabel}
            aria-keyshortcuts={SHORTCUT_KEYS.toggle}
            title={toggleLabel}
            onClick={onToggle}
          >
            {status === 'paused' ? <PlayIcon /> : <PauseIcon />}
          </button>
          <button
            type="button"
            className={classes.icon}
            aria-label={resetLabel}
            aria-keyshortcuts={SHORTCUT_KEYS.reset}
            title={resetLabel}
            onClick={onReset}
          >
            <ResetIcon />
          </button>
          <button
            type="button"
            className={classes.icon}
            aria-label={cancelLabel}
            title={cancelLabel}
            onClick={onCancel}
          >
            <CancelIcon />
          </button>
        </>
      )}
      {/* Always in the document: a live region only announces changes to a
          region that already existed, so the span stays mounted and only its
          text appears on completion — which is once, and exactly what a
          screen-reader user needs in place of glancing at the window. Empty
          it is taken out of flow by the stylesheet. */}
      <span className={classes.done} role="status">
        {status === 'completed' ? t(language, 'clockTimer.done') : ''}
      </span>
      {status === 'completed' && (
        <button
          type="button"
          className={classes.dismiss}
          aria-label={dismissLabel}
          title={dismissLabel}
          onClick={onDismiss}
        >
          <CheckIcon />
        </button>
      )}
    </div>
  )
}

interface ClockTimerPresetsProps {
  variant: Variant
  language: Language
  onStart: (preset: ClockTimerPresetId) => void
}

/**
 * The preset buttons. Picking one while a timer exists simply replaces it —
 * the main process swaps the countdown atomically. The mini bar (and a narrow
 * window) has room only for the bare minute counts, so there the full label
 * lives on in the accessible name.
 */
export function ClockTimerPresets({
  variant,
  language,
  onStart
}: ClockTimerPresetsProps): React.JSX.Element {
  const classes = CLASSES[variant]
  return (
    <div className={classes.presets} role="group" aria-label={t(language, 'clockTimer.startLabel')}>
      {CLOCK_TIMER_PRESETS.map((preset) => {
        const label = t(language, `clockTimer.preset.${preset.id}`)
        return (
          <button
            key={preset.id}
            type="button"
            className={classes.preset}
            aria-label={label}
            title={label}
            onClick={() => onStart(preset.id)}
          >
            {variant === 'mini' ? (
              preset.minutes
            ) : (
              // Both forms are rendered and the stylesheet shows one: a narrow
              // window drops to the bare count so the row stays on one line.
              <>
                <span className="ctimer__preset-label">{label}</span>
                <span className="ctimer__preset-count" aria-hidden="true">
                  {preset.minutes}
                </span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* Shaped like the mini bar's pomodoro toggle glyphs, drawn as SVG throughout
   so they scale with the UI zoom. */

function PlayIcon(): React.JSX.Element {
  return (
    <svg width="10" height="11" viewBox="0 0 11 12" aria-hidden="true">
      <polygon points="1,0 11,6 1,12" fill="currentColor" />
    </svg>
  )
}

function PauseIcon(): React.JSX.Element {
  return (
    <svg width="10" height="11" viewBox="0 0 10 11" aria-hidden="true">
      <rect x="1" y="0" width="3" height="11" rx="1" fill="currentColor" />
      <rect x="6" y="0" width="3" height="11" rx="1" fill="currentColor" />
    </svg>
  )
}

function ResetIcon(): React.JSX.Element {
  return (
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
      <path d="M2.5 4.5 A4 4 0 1 1 2 7" />
      <path d="M2.5 1 V4.5 H6" />
    </svg>
  )
}

function CancelIcon(): React.JSX.Element {
  return (
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
  )
}

function CheckIcon(): React.JSX.Element {
  return (
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
  )
}
