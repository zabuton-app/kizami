import { useEffect, useState } from 'react'
import { SHIFT_RESET_MS, wrapShiftHours } from '../shared/clock'
import { detectLanguage } from '../shared/settings'
import { DEFAULT_THEME, THEMES, type ThemeId } from '../shared/themes'
import type { SecondaryTimeZone } from '../shared/timezones'
import {
  DEFAULT_CLOCK_FORMAT,
  DEFAULT_SETTINGS,
  DEFAULT_TIME_DISPLAY,
  type ClockFormat,
  type Language,
  type Settings,
  type TimeDisplayMode,
  type TimerSnapshot,
  type UpdateStatus
} from '../shared/types'
import { accumulateWheelSteps } from '../shared/wheel-steps'
import { TitleBar } from './components/TitleBar'
import { ClockView } from './views/ClockView'
import { MiniClockView } from './views/MiniClockView'
import { MiniTimerView } from './views/MiniTimerView'
import { SettingsView } from './views/SettingsView'
import { TimerView } from './views/TimerView'

type View = 'timer' | 'settings'

/**
 * Height (CSS px) under which the window can only be physically mini-sized —
 * either mini mode is on, or it was just left and the compositor has not
 * applied the grow yet (Wayland resizes asynchronously). Either way the
 * window is WINDOW_MINI_SIZE.height (58) CSS px, since the mini window
 * tracks the zoom. A normal-mode window bottoms out around 173 CSS px in the
 * worst case (shrunk to the zoom-0.6 floor, then zoomed to 1.5 — zooming
 * rescales the CSS px but never grows the window). Keeping the threshold
 * well under that worst case is what guarantees zooming the normal view in
 * can never flip it into the mini bar; the mode itself is only ever entered
 * explicitly via settings.miniMode. Raising ZOOM_MAX (popup-window.ts)
 * lowers that worst case — revisit this value if it changes.
 */
const MINI_HEIGHT_THRESHOLD = 120

/**
 * Expose the active theme's tokens as CSS custom properties on `:root`, so
 * every `var()` reference resolves to the theme — including rules outside
 * `.app` such as `body { color: var(--ink) }`.
 */
function applyThemeTokens(themeId: ThemeId): void {
  const t = THEMES[themeId]
  const tokens: Record<string, string> = {
    '--bg': t.bg,
    '--ink': t.ink,
    '--card': t.card,
    '--badge': t.badge,
    '--primary': t.primary,
    '--primary-text': t.primaryText,
    '--palette-1': t.palette[0],
    '--palette-2': t.palette[1],
    '--palette-3': t.palette[2],
    '--empty': t.empty,
    '--sub': t.sub
  }
  for (const [name, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(name, value)
  }
}

/**
 * How far the clock display is moved from now, and what it takes to keep
 * moving it. `hours` is always inside the allowed range, wrapping back to
 * zero past either end; `remainder` is the sub-step distance the wheel
 * accumulator carries between events; `nonce` counts inputs so the
 * auto-return timer can restart on one that leaves `hours` alone — a scroll
 * that only accumulates remainder, since every input that reaches a step now
 * moves the clock somewhere.
 */
export interface ShiftState {
  readonly hours: number
  readonly remainder: number
  readonly nonce: number
}

/** What a clock view needs to show the shift and to change it. */
export interface ClockShiftProps {
  readonly shiftHours: number
  readonly onWheelShift: (deltaY: number, deltaMode: number) => void
  readonly onKeyShift: (direction: 1 | -1) => void
}

/**
 * The clock showing the real current time. Reused rather than rebuilt so
 * returning to it is reference-equal and React can skip the re-render.
 */
const NO_SHIFT: ShiftState = { hours: 0, remainder: 0, nonce: 0 }

/**
 * Next state after one wheel event. Written as a pure updater because
 * StrictMode invokes `useState` updaters twice; deriving everything from the
 * passed state keeps the second call identical to the first. `deltaY` is
 * passed through untouched — `accumulateWheelSteps` owns the one sign
 * inversion that makes an upward scroll move the clock forward.
 */
export function shiftByWheel(state: ShiftState, deltaY: number, deltaMode: number): ShiftState {
  const { steps, remainder } = accumulateWheelSteps(state.remainder, deltaY, deltaMode)
  return {
    hours: wrapShiftHours(state.hours + steps),
    remainder,
    nonce: state.nonce + 1
  }
}

/**
 * Next state after one keyboard step, the accessible equivalent of a notch.
 * It drops the wheel remainder: the gesture the remainder belonged to is over,
 * and carrying it would let a later half-notch scroll jump a whole hour.
 */
export function shiftByDirection(state: ShiftState, direction: 1 | -1): ShiftState {
  return {
    hours: wrapShiftHours(state.hours + direction),
    remainder: 0,
    nonce: state.nonce + 1
  }
}

export function App(): React.JSX.Element | null {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [view, setView] = useState<View>('timer')
  // Owned here rather than in a clock view so it survives the swap between the
  // mini bar and the normal window: the main process only calls setSize(), so
  // App is never remounted and the shift is carried across (3.7). It is also
  // never written to settings and never crosses IPC, which is what makes a
  // restart start unshifted and leaves the timer alone (3.9, 5.4, 5.5).
  const [shift, setShift] = useState<ShiftState>(NO_SHIFT)

  useEffect(() => {
    void window.kizami.getSnapshot().then(setSnapshot)
    void window.kizami.getSettings().then(setSettings)
    // The startup check may land before or after this mounts, so read the
    // current verdict and also subscribe for a later one.
    void window.kizami.getUpdateStatus().then(setUpdateStatus)
    const offSnapshot = window.kizami.onSnapshot(setSnapshot)
    const offSettings = window.kizami.onSettingsChanged(setSettings)
    const offUpdate = window.kizami.onUpdateChanged(setUpdateStatus)
    return () => {
      offSnapshot()
      offSettings()
      offUpdate()
    }
  }, [])

  const language: Language =
    settings?.language ?? snapshot?.language ?? detectLanguage(navigator.language)

  const theme: ThemeId = settings?.theme ?? DEFAULT_THEME

  const timeDisplay: TimeDisplayMode = settings?.timeDisplay ?? DEFAULT_TIME_DISPLAY

  const sessionsPerCycle = settings?.sessionsPerCycle ?? DEFAULT_SETTINGS.sessionsPerCycle

  const miniMode = settings?.miniMode ?? false

  const clockMode = settings?.clockMode ?? false

  const clockFormat: ClockFormat = settings?.clockFormat ?? DEFAULT_CLOCK_FORMAT

  const secondaryTimeZone: SecondaryTimeZone =
    settings?.secondaryTimeZone ?? DEFAULT_SETTINGS.secondaryTimeZone

  useEffect(() => {
    applyThemeTokens(theme)
  }, [theme])

  // A shifted clock returns to now on its own, so a tray-resident window is
  // never left showing a time that is not the current one (5.1). The nonce is
  // in the dependencies so any input restarts the wait, including one that
  // leaves the hour where it was (5.2), while the once-a-second display tick
  // lives in the views and cannot disturb it. Nothing is scheduled while the
  // clock is already live, so scrolling back to zero ends the shift at once
  // instead of after a leftover wait.
  useEffect(() => {
    if (shift.hours === 0) return
    const id = window.setTimeout(() => setShift(NO_SHIFT), SHIFT_RESET_MS)
    return () => window.clearTimeout(id)
  }, [shift.hours, shift.nonce])

  // Leaving clock mode discards the shift eagerly, so coming back shows the
  // current time rather than a stale moment (5.3). Re-setting the same
  // constant is reference-equal, so the common case bails out of re-rendering.
  useEffect(() => {
    if (!clockMode) setShift(NO_SHIFT)
  }, [clockMode])

  // Mini mode has no settings entry point, so leaving it must always land on
  // the timer — even if miniMode was turned on while the settings view was
  // open (e.g. a settings broadcast from the main process).
  useEffect(() => {
    if (miniMode) setView('timer')
  }, [miniMode])

  // The main process resizes the window and tells the renderer in the same
  // turn, but the compositor applies the resize asynchronously (Wayland). If
  // the normal view rendered right away it would lay out inside the mini
  // window's 380x58 and spill out of it. So keep showing the bar until the
  // window has actually grown back.
  //
  // The threshold sits above the tallest mini window (WINDOW_MINI_SIZE.height
  // at the maximum zoom) and below the shortest normal one, so zooming the
  // normal view out never trips it.
  const [windowIsMiniSized, setWindowIsMiniSized] = useState(
    () => window.innerHeight < MINI_HEIGHT_THRESHOLD
  )
  useEffect(() => {
    const sync = (): void => setWindowIsMiniSized(window.innerHeight < MINI_HEIGHT_THRESHOLD)
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  // Only the exit direction needs the guard: entering mini mode shrinks the
  // window, and the bar fits the old size just fine in the meantime.
  const showMiniBar = miniMode || windowIsMiniSized

  // Mini mode draws no title bar, so Escape stands in for the expand button
  // and returns to the normal window. It reads as backing out of the bar
  // rather than as dismissing the app, and the window can still be put away
  // from the tray or from the normal view's close button.
  //
  // Only bound in mini mode: the normal view has the buttons, and a global
  // binding would swallow the Escape that cancels an IME conversion in the
  // settings form.
  useEffect(() => {
    if (!showMiniBar) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented) {
        void window.kizami.updateSettings({ miniMode: false }).then(setSettings)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showMiniBar])

  // Mini mode is a single bar with no title bar: the bar itself is the drag
  // handle, Escape leaves the bar for the normal window, and the tray icon is
  // what puts the window away.
  if (showMiniBar) {
    return (
      <div className="app app--mini">
        {clockMode ? (
          <MiniClockView
            clockFormat={clockFormat}
            language={language}
            secondaryTimeZone={secondaryTimeZone}
            shift={{
              shiftHours: shift.hours,
              onWheelShift: (deltaY, deltaMode) =>
                setShift((s) => shiftByWheel(s, deltaY, deltaMode)),
              onKeyShift: (direction) => setShift((s) => shiftByDirection(s, direction))
            }}
            onExitMini={() =>
              void window.kizami.updateSettings({ miniMode: false }).then(setSettings)
            }
          />
        ) : (
          snapshot && (
            <MiniTimerView
              snapshot={snapshot}
              language={language}
              timeDisplay={timeDisplay}
              onToggle={() => void window.kizami.toggle().then(setSnapshot)}
              onSkip={() => void window.kizami.skip().then(setSnapshot)}
              onExitMini={() =>
                void window.kizami.updateSettings({ miniMode: false }).then(setSettings)
              }
            />
          )
        )}
      </div>
    )
  }

  return (
    <div className="app">
      <TitleBar
        settingsOpen={view === 'settings'}
        language={language}
        updateAvailable={updateStatus?.available ?? false}
        clockMode={clockMode}
        onClose={() => void window.kizami.hideWindow()}
        onToggleSettings={() => setView((v) => (v === 'timer' ? 'settings' : 'timer'))}
        onToggleMini={() => void window.kizami.updateSettings({ miniMode: true }).then(setSettings)}
        onToggleClock={() =>
          void window.kizami.updateSettings({ clockMode: !clockMode }).then(setSettings)
        }
      />
      {view === 'settings'
        ? settings && (
            <SettingsView
              settings={settings}
              language={language}
              onUpdate={(patch) => void window.kizami.updateSettings(patch).then(setSettings)}
            />
          )
        : clockMode
          ? snapshot && (
              <ClockView
                snapshot={snapshot}
                language={language}
                theme={theme}
                sessionsPerCycle={sessionsPerCycle}
                clockFormat={clockFormat}
                secondaryTimeZone={secondaryTimeZone}
                shift={{
                  shiftHours: shift.hours,
                  onWheelShift: (deltaY, deltaMode) =>
                    setShift((s) => shiftByWheel(s, deltaY, deltaMode)),
                  onKeyShift: (direction) => setShift((s) => shiftByDirection(s, direction))
                }}
                onSelectTheme={(next) =>
                  void window.kizami.updateSettings({ theme: next }).then(setSettings)
                }
              />
            )
          : snapshot && (
              <TimerView
                snapshot={snapshot}
                language={language}
                theme={theme}
                timeDisplay={timeDisplay}
                sessionsPerCycle={sessionsPerCycle}
                onToggle={() => void window.kizami.toggle().then(setSnapshot)}
                onSkip={() => void window.kizami.skip().then(setSnapshot)}
                onSelectTheme={(next) =>
                  void window.kizami.updateSettings({ theme: next }).then(setSettings)
                }
              />
            )}
    </div>
  )
}
