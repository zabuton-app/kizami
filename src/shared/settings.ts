import { asThemeId } from './themes'
import {
  CLOCK_FORMATS,
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  TIME_DISPLAY_MODES,
  TRAY_ICON_IDS,
  type ClockFormat,
  type Language,
  type Settings,
  type TimeDisplayMode,
  type TrayIconId
} from './types'

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asTaskName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return value.slice(0, SETTINGS_LIMITS.taskNameMaxLength)
}

function asLanguage(value: unknown, fallback: Language): Language {
  return value === 'ja' || value === 'en' ? value : fallback
}

function asTrayIconId(value: unknown, fallback: TrayIconId): TrayIconId {
  return typeof value === 'string' && (TRAY_ICON_IDS as readonly string[]).includes(value)
    ? (value as TrayIconId)
    : fallback
}

function asTimeDisplayMode(value: unknown, fallback: TimeDisplayMode): TimeDisplayMode {
  return typeof value === 'string' && (TIME_DISPLAY_MODES as readonly string[]).includes(value)
    ? (value as TimeDisplayMode)
    : fallback
}

function asClockFormat(value: unknown, fallback: ClockFormat): ClockFormat {
  return typeof value === 'string' && (CLOCK_FORMATS as readonly string[]).includes(value)
    ? (value as ClockFormat)
    : fallback
}

/**
 * Coerce arbitrary (possibly corrupted) data into a valid Settings object.
 * Out-of-range numbers are clamped; wrong types fall back to defaults.
 */
export function sanitizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  return {
    workMinutes: clampInt(
      raw.workMinutes,
      SETTINGS_LIMITS.workMinutes.min,
      SETTINGS_LIMITS.workMinutes.max,
      base.workMinutes
    ),
    shortBreakMinutes: clampInt(
      raw.shortBreakMinutes,
      SETTINGS_LIMITS.shortBreakMinutes.min,
      SETTINGS_LIMITS.shortBreakMinutes.max,
      base.shortBreakMinutes
    ),
    longBreakMinutes: clampInt(
      raw.longBreakMinutes,
      SETTINGS_LIMITS.longBreakMinutes.min,
      SETTINGS_LIMITS.longBreakMinutes.max,
      base.longBreakMinutes
    ),
    sessionsPerCycle: clampInt(
      raw.sessionsPerCycle,
      SETTINGS_LIMITS.sessionsPerCycle.min,
      SETTINGS_LIMITS.sessionsPerCycle.max,
      base.sessionsPerCycle
    ),
    autoStart: asBoolean(raw.autoStart, base.autoStart),
    taskName: asTaskName(raw.taskName, base.taskName),
    language: asLanguage(raw.language, base.language),
    theme: asThemeId(raw.theme, base.theme),
    miniMode: asBoolean(raw.miniMode, base.miniMode),
    trayIcon: asTrayIconId(raw.trayIcon, base.trayIcon),
    timeDisplay: asTimeDisplayMode(raw.timeDisplay, base.timeDisplay),
    clockMode: asBoolean(raw.clockMode, base.clockMode),
    clockFormat: asClockFormat(raw.clockFormat, base.clockFormat)
  }
}

/** Apply a partial update on top of current settings, clamping every field. */
export function applySettingsUpdate(current: Settings, patch: unknown): Settings {
  const raw = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<string, unknown>
  return sanitizeSettings({ ...current, ...raw }, current)
}

/** Map an OS locale string to a supported UI language. */
export function detectLanguage(locale: string): Language {
  return locale.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}
