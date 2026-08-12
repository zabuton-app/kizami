import { describe, expect, it } from 'vitest'
import { applySettingsUpdate, detectLanguage, sanitizeSettings } from '../../src/shared/settings'
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types'

const current: Settings = {
  workMinutes: 30,
  shortBreakMinutes: 10,
  longBreakMinutes: 20,
  autoStart: false,
  taskName: 'Review the design spec',
  language: 'ja',
  theme: 'grapeGummy',
  miniMode: false,
  trayIcon: 'tomato',
  timeDisplay: 'elapsed'
}

describe('sanitizeSettings', () => {
  it('returns defaults for non-object input', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings('broken json')).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps out-of-range numbers to min/max', () => {
    const result = sanitizeSettings({
      workMinutes: 0,
      shortBreakMinutes: 999,
      longBreakMinutes: -5
    })
    expect(result.workMinutes).toBe(5)
    expect(result.shortBreakMinutes).toBe(30)
    expect(result.longBreakMinutes).toBe(5)
  })

  it('rounds fractional minutes', () => {
    expect(sanitizeSettings({ workMinutes: 25.7 }).workMinutes).toBe(26)
  })

  it('falls back per-field on wrong types', () => {
    const result = sanitizeSettings({
      workMinutes: 'twenty',
      autoStart: 'yes',
      taskName: 42,
      language: 'fr'
    })
    expect(result).toEqual(DEFAULT_SETTINGS)
  })

  it('truncates over-long task names', () => {
    const result = sanitizeSettings({ taskName: 'a'.repeat(500) })
    expect(result.taskName).toHaveLength(100)
  })

  it('accepts every valid theme id', () => {
    expect(sanitizeSettings({ theme: 'nightPudding' }).theme).toBe('nightPudding')
    expect(sanitizeSettings({ theme: 'strawberryMilk' }).theme).toBe('strawberryMilk')
  })

  it('falls back to the default theme on invalid values', () => {
    expect(sanitizeSettings({ theme: 'neon' }).theme).toBe('candy')
    expect(sanitizeSettings({ theme: 42 }).theme).toBe('candy')
    expect(sanitizeSettings({ theme: null }).theme).toBe('candy')
  })

  it('defaults theme to candy when the field is missing (pre-theme settings file)', () => {
    expect(sanitizeSettings({ workMinutes: 30 }).theme).toBe('candy')
  })

  it('defaults miniMode to false when the field is missing (pre-mini settings file)', () => {
    expect(sanitizeSettings({ workMinutes: 30 }).miniMode).toBe(false)
  })

  it('falls back to the base miniMode on non-boolean values', () => {
    expect(sanitizeSettings({ miniMode: 'yes' }).miniMode).toBe(false)
    expect(sanitizeSettings({ miniMode: 1 }).miniMode).toBe(false)
    expect(sanitizeSettings({ miniMode: null }).miniMode).toBe(false)
  })

  it('accepts a boolean miniMode', () => {
    expect(sanitizeSettings({ miniMode: true }).miniMode).toBe(true)
  })

  it('accepts every valid tray icon id', () => {
    expect(sanitizeSettings({ trayIcon: 'kizami' }).trayIcon).toBe('kizami')
    expect(sanitizeSettings({ trayIcon: 'tomato' }).trayIcon).toBe('tomato')
  })

  it('falls back to the default tray icon on invalid values', () => {
    expect(sanitizeSettings({ trayIcon: 'banana' }).trayIcon).toBe('kizami')
    expect(sanitizeSettings({ trayIcon: 42 }).trayIcon).toBe('kizami')
    expect(sanitizeSettings({ trayIcon: null }).trayIcon).toBe('kizami')
  })

  it('defaults trayIcon to kizami when the field is missing (pre-icon settings file)', () => {
    expect(sanitizeSettings({ workMinutes: 30 }).trayIcon).toBe('kizami')
  })

  it('accepts every valid time display mode', () => {
    expect(sanitizeSettings({ timeDisplay: 'remaining' }).timeDisplay).toBe('remaining')
    expect(sanitizeSettings({ timeDisplay: 'elapsed' }).timeDisplay).toBe('elapsed')
  })

  it('falls back to counting down on invalid time display values', () => {
    expect(sanitizeSettings({ timeDisplay: 'countup' }).timeDisplay).toBe('remaining')
    expect(sanitizeSettings({ timeDisplay: 42 }).timeDisplay).toBe('remaining')
    expect(sanitizeSettings({ timeDisplay: null }).timeDisplay).toBe('remaining')
  })

  it('counts down when the field is missing (pre-feature settings file)', () => {
    const result = sanitizeSettings({ workMinutes: 30, theme: 'melonSoda' })
    expect(result.timeDisplay).toBe('remaining')
    // The unknown-field fallback must not cost the settings that were there.
    expect(result.workMinutes).toBe(30)
    expect(result.theme).toBe('melonSoda')
  })
})

describe('applySettingsUpdate', () => {
  it('applies a partial patch keeping other fields', () => {
    const result = applySettingsUpdate(current, { workMinutes: 45 })
    expect(result).toEqual({ ...current, workMinutes: 45 })
  })

  it('clamps patched values against limits', () => {
    expect(applySettingsUpdate(current, { workMinutes: 120 }).workMinutes).toBe(60)
    expect(applySettingsUpdate(current, { shortBreakMinutes: 0 }).shortBreakMinutes).toBe(1)
  })

  it('ignores invalid patch values keeping current ones', () => {
    const result = applySettingsUpdate(current, { language: 'de', autoStart: 1 })
    expect(result.language).toBe('ja')
    expect(result.autoStart).toBe(false)
  })

  it('tolerates non-object patches', () => {
    expect(applySettingsUpdate(current, null)).toEqual(current)
    expect(applySettingsUpdate(current, 'nope')).toEqual(current)
  })

  it('updates the theme and keeps other fields', () => {
    const result = applySettingsUpdate(current, { theme: 'melonSoda' })
    expect(result).toEqual({ ...current, theme: 'melonSoda' })
  })

  it('keeps the current theme on invalid patch values', () => {
    expect(applySettingsUpdate(current, { theme: 'neon' }).theme).toBe('grapeGummy')
  })

  it('toggles miniMode and keeps other fields', () => {
    const result = applySettingsUpdate(current, { miniMode: true })
    expect(result).toEqual({ ...current, miniMode: true })
  })

  it('keeps the current miniMode on invalid patch values', () => {
    const on = { ...current, miniMode: true }
    expect(applySettingsUpdate(on, { miniMode: 'off' }).miniMode).toBe(true)
  })

  it('switches the tray icon and keeps other fields', () => {
    const result = applySettingsUpdate(current, { trayIcon: 'kizami' })
    expect(result).toEqual({ ...current, trayIcon: 'kizami' })
  })

  it('keeps the current tray icon on invalid patch values', () => {
    expect(applySettingsUpdate(current, { trayIcon: 'neon' }).trayIcon).toBe('tomato')
  })

  it('switches the time display and keeps other fields', () => {
    const result = applySettingsUpdate(current, { timeDisplay: 'remaining' })
    expect(result).toEqual({ ...current, timeDisplay: 'remaining' })
  })

  it('keeps the current time display on invalid patch values', () => {
    expect(applySettingsUpdate(current, { timeDisplay: 'countdown' }).timeDisplay).toBe('elapsed')
  })

  it('round-trips an updated theme through the sanitizer unchanged', () => {
    const updated = applySettingsUpdate(current, { theme: 'nightPudding' })
    expect(sanitizeSettings(updated)).toEqual(updated)
  })
})

describe('detectLanguage', () => {
  it('maps ja locales to ja', () => {
    expect(detectLanguage('ja')).toBe('ja')
    expect(detectLanguage('ja-JP')).toBe('ja')
    expect(detectLanguage('JA-JP')).toBe('ja')
  })

  it('maps everything else to en', () => {
    expect(detectLanguage('en-US')).toBe('en')
    expect(detectLanguage('fr-FR')).toBe('en')
    expect(detectLanguage('')).toBe('en')
  })
})
