import type { AboutInfo } from './about'
import { DEFAULT_THEME, type ThemeId } from './themes'

export type Phase = 'work' | 'shortBreak' | 'longBreak'

export type Language = 'ja' | 'en'

/** Selectable tray icon: the current kizami logo or the original tomato. */
export type TrayIconId = 'kizami' | 'tomato'

export const TRAY_ICON_IDS: readonly TrayIconId[] = ['kizami', 'tomato']

export const DEFAULT_TRAY_ICON: TrayIconId = 'kizami'

/** Direction the timer reads: time left in the phase, or time spent in it. */
export type TimeDisplayMode = 'remaining' | 'elapsed'

export const TIME_DISPLAY_MODES: readonly TimeDisplayMode[] = ['remaining', 'elapsed']

export const DEFAULT_TIME_DISPLAY: TimeDisplayMode = 'remaining'

export interface Settings {
  workMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  autoStart: boolean
  taskName: string
  language: Language
  theme: ThemeId
  miniMode: boolean
  trayIcon: TrayIconId
  timeDisplay: TimeDisplayMode
}

export const SETTINGS_LIMITS = {
  workMinutes: { min: 5, max: 60 },
  shortBreakMinutes: { min: 1, max: 30 },
  longBreakMinutes: { min: 5, max: 60 },
  taskNameMaxLength: 100
} as const

export const DEFAULT_SETTINGS: Settings = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  autoStart: true,
  taskName: '',
  language: 'en',
  theme: DEFAULT_THEME,
  miniMode: false,
  trayIcon: DEFAULT_TRAY_ICON,
  timeDisplay: DEFAULT_TIME_DISPLAY
}

/** Design size of the popup window; the renderer scales down from this. */
export const WINDOW_SIZE = { width: 400, height: 560 } as const

/**
 * Height of the timer layout at design width once the flexible slack between
 * the buttons and the theme picker is fully collapsed. Shrinking the window
 * height only removes that slack, so this is the height floor.
 */
export const WINDOW_MIN_CONTENT_HEIGHT = 432

/** Smallest allowed popup width, as a fraction of the design width. */
export const WINDOW_MIN_SCALE = 0.7

/**
 * Fixed size of the popup in mini mode (at zoom factor 1). Mini mode is a
 * single horizontal bar: the width matches the design, the height fits one
 * row of controls (the toggle button plus the bar's padding and border).
 */
export const WINDOW_MINI_SIZE = { width: 380, height: 58 } as const

export const SESSIONS_PER_CYCLE = 4

export const PROGRESS_BLOCKS = 10

/**
 * Internal timer state held by the main process only (never persisted).
 * While running, `endsAt` is the wall-clock end time of the current phase
 * and `remainingMs` is stale; while paused, `remainingMs` is authoritative
 * and `endsAt` is null. `totalMs` is captured when the phase is entered so a
 * settings change cannot rewrite the progress of an already-started phase.
 */
export interface TimerState {
  phase: Phase
  session: number
  running: boolean
  /** Whether this phase has ever been started. */
  started: boolean
  endsAt: number | null
  remainingMs: number
  /** Duration assigned when this phase was entered (or changed while fresh). */
  totalMs: number
}

/** Display-ready snapshot pushed to the renderer over IPC. */
export interface TimerSnapshot {
  phase: Phase
  session: number
  running: boolean
  /** True until the current phase has been started for the first time. */
  fresh: boolean
  remainingSec: number
  totalSec: number
  filledBlocks: number
  taskName: string
  language: Language
}

/**
 * Persisted update-check state, stored separately from `Settings` so that
 * `lastCheckedAt` — which backs the throttle — cannot be rewritten from the
 * renderer the way settings can.
 */
export interface UpdateState {
  autoCheck: boolean
  /** Normalized (no leading "v"). Null when nothing is being skipped. */
  skippedVersion: string | null
  /** Epoch ms of the last *successful* check; drives the throttle. */
  lastCheckedAt: number | null
}

export const DEFAULT_UPDATE_STATE: UpdateState = {
  autoCheck: true,
  skippedVersion: null,
  lastCheckedAt: null
}

/** Skip auto-checks for this long after a successful one. */
export const UPDATE_CHECK_THROTTLE_MS = 6 * 60 * 60 * 1000

/**
 * Outcome of a single check. A failed check is represented by `null` rather
 * than by this shape, so "up to date" and "couldn't check" stay distinct.
 */
export interface UpdateCheckResult {
  current: string
  latest: string
  available: boolean
  url: string
  name: string | null
  publishedAt: string | null
}

/** Current update state as the renderer needs it (badge + settings screen). */
export interface UpdateStatus {
  currentVersion: string
  autoCheck: boolean
  /** Whether to show the badge: a newer, non-skipped version was detected. */
  available: boolean
  latestVersion: string | null
  url: string | null
}

export const IPC = {
  timerGetSnapshot: 'timer:getSnapshot',
  timerToggle: 'timer:toggle',
  timerSkip: 'timer:skip',
  timerSnapshot: 'timer:snapshot',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsChanged: 'settings:changed',
  windowHide: 'window:hide',
  updateGetStatus: 'update:getStatus',
  updateCheck: 'update:check',
  updateSetAutoCheck: 'update:setAutoCheck',
  updateSkip: 'update:skip',
  updateChanged: 'update:changed',
  shellOpenExternal: 'shell:openExternal',
  aboutInfo: 'about:info',
  aboutOpenUrl: 'about:openUrl'
} as const

/** API surface exposed to the renderer via the preload bridge. */
export interface KizamiApi {
  getSnapshot(): Promise<TimerSnapshot>
  toggle(): Promise<TimerSnapshot>
  skip(): Promise<TimerSnapshot>
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  hideWindow(): Promise<void>
  onSnapshot(callback: (snapshot: TimerSnapshot) => void): () => void
  onSettingsChanged(callback: (settings: Settings) => void): () => void
  getUpdateStatus(): Promise<UpdateStatus>
  /** Resolves to null when the check could not complete (never rejects). */
  checkForUpdate(): Promise<UpdateCheckResult | null>
  setUpdateAutoCheck(enabled: boolean): Promise<UpdateStatus>
  skipUpdateVersion(version: string): Promise<UpdateStatus>
  openReleasePage(url: string): Promise<void>
  onUpdateChanged(callback: (status: UpdateStatus) => void): () => void
  aboutInfo(): Promise<AboutInfo>
  /** Opens a URL from the fixed About allow-list (`ABOUT_URLS`); anything else is ignored. */
  openAboutUrl(url: string): Promise<void>
}
