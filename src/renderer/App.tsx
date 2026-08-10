import { useEffect, useState } from 'react'
import { detectLanguage } from '../shared/settings'
import { DEFAULT_THEME, THEMES, type ThemeId } from '../shared/themes'
import type { Language, Settings, TimerSnapshot, UpdateStatus } from '../shared/types'
import { TitleBar } from './components/TitleBar'
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

export function App(): React.JSX.Element | null {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [view, setView] = useState<View>('timer')

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

  const miniMode = settings?.miniMode ?? false

  useEffect(() => {
    applyThemeTokens(theme)
  }, [theme])

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

  // Mini mode draws no title bar, so Escape stands in for its close button.
  // Only bound there: the normal view has the button, and a global binding
  // would swallow the Escape that cancels an IME conversion in the settings
  // form.
  useEffect(() => {
    if (!showMiniBar) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented) {
        void window.kizami.hideWindow()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showMiniBar])

  // Mini mode is a single bar with no title bar: the bar itself is the drag
  // handle, and the window is dismissed with Escape or the tray icon.
  if (showMiniBar) {
    return (
      <div className="app app--mini">
        {snapshot && (
          <MiniTimerView
            snapshot={snapshot}
            language={language}
            onToggle={() => void window.kizami.toggle().then(setSnapshot)}
            onSkip={() => void window.kizami.skip().then(setSnapshot)}
            onExitMini={() =>
              void window.kizami.updateSettings({ miniMode: false }).then(setSettings)
            }
          />
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
        onClose={() => void window.kizami.hideWindow()}
        onToggleSettings={() => setView((v) => (v === 'timer' ? 'settings' : 'timer'))}
        onToggleMini={() => void window.kizami.updateSettings({ miniMode: true }).then(setSettings)}
      />
      {view === 'timer'
        ? snapshot && (
            <TimerView
              snapshot={snapshot}
              language={language}
              theme={theme}
              onToggle={() => void window.kizami.toggle().then(setSnapshot)}
              onSkip={() => void window.kizami.skip().then(setSnapshot)}
              onSelectTheme={(next) =>
                void window.kizami.updateSettings({ theme: next }).then(setSettings)
              }
            />
          )
        : settings && (
            <SettingsView
              settings={settings}
              language={language}
              onUpdate={(patch) => void window.kizami.updateSettings(patch).then(setSettings)}
            />
          )}
    </div>
  )
}
