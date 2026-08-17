import { describe, expect, it } from 'vitest'
import {
  applySettingsUpdate,
  asSecondaryTimeZone,
  detectLanguage,
  sanitizeSettings
} from '../../src/shared/settings'
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types'

const current: Settings = {
  workMinutes: 30,
  shortBreakMinutes: 10,
  longBreakMinutes: 20,
  sessionsPerCycle: 6,
  autoStart: false,
  taskName: 'Review the design spec',
  language: 'ja',
  theme: 'grapeGummy',
  miniMode: false,
  trayIcon: 'tomato',
  timeDisplay: 'elapsed',
  clockMode: true,
  clockFormat: 'hhmmss',
  secondaryTimeZone: 'America/New_York'
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

  it('accepts a boolean clockMode', () => {
    expect(sanitizeSettings({ clockMode: true }).clockMode).toBe(true)
    expect(sanitizeSettings({ clockMode: false }).clockMode).toBe(false)
  })

  it('falls back to the base clockMode on non-boolean values', () => {
    expect(sanitizeSettings({ clockMode: 'yes' }).clockMode).toBe(false)
    expect(sanitizeSettings({ clockMode: 1 }).clockMode).toBe(false)
    expect(sanitizeSettings({ clockMode: null }).clockMode).toBe(false)
  })

  it('accepts every valid clock format', () => {
    expect(sanitizeSettings({ clockFormat: 'hhmm' }).clockFormat).toBe('hhmm')
    expect(sanitizeSettings({ clockFormat: 'hhmmss' }).clockFormat).toBe('hhmmss')
  })

  it('falls back to hh:mm on invalid clock format values', () => {
    expect(sanitizeSettings({ clockFormat: 'banana' }).clockFormat).toBe('hhmm')
    expect(sanitizeSettings({ clockFormat: 42 }).clockFormat).toBe('hhmm')
    expect(sanitizeSettings({ clockFormat: null }).clockFormat).toBe('hhmm')
  })

  it('keeps the timer view when the fields are missing (pre-clock settings file)', () => {
    const result = sanitizeSettings({ workMinutes: 30, theme: 'melonSoda' })
    expect(result.clockMode).toBe(false)
    expect(result.clockFormat).toBe('hhmm')
    // The missing-field fallback must not cost the settings that were there.
    expect(result.workMinutes).toBe(30)
    expect(result.theme).toBe('melonSoda')
  })

  it('accepts a curated comparison zone', () => {
    expect(sanitizeSettings({ secondaryTimeZone: 'Asia/Tokyo' }).secondaryTimeZone).toBe(
      'Asia/Tokyo'
    )
    expect(sanitizeSettings({ secondaryTimeZone: 'UTC' }).secondaryTimeZone).toBe('UTC')
  })

  it('round-trips a stored comparison zone unchanged', () => {
    const stored: Settings = { ...current, secondaryTimeZone: 'Europe/London' }
    expect(sanitizeSettings(stored)).toEqual(stored)
  })

  it('accepts null as the explicit "not set" choice instead of falling back', () => {
    expect(sanitizeSettings({ secondaryTimeZone: null }, current).secondaryTimeZone).toBeNull()
  })

  it('falls back to the base comparison zone on invalid values', () => {
    const base = current.secondaryTimeZone
    expect(sanitizeSettings({ secondaryTimeZone: 'nowhere' }, current).secondaryTimeZone).toBe(base)
    expect(sanitizeSettings({ secondaryTimeZone: 42 }, current).secondaryTimeZone).toBe(base)
    expect(sanitizeSettings({ secondaryTimeZone: {} }, current).secondaryTimeZone).toBe(base)
    // Valid IANA, but absent from the catalog: no control could select it back.
    expect(sanitizeSettings({ secondaryTimeZone: 'Europe/Rome' }, current).secondaryTimeZone).toBe(
      base
    )
  })

  it('leaves the comparison zone unset when the field is missing (pre-world-clock file)', () => {
    const result = sanitizeSettings({ workMinutes: 30, theme: 'melonSoda' })
    expect(DEFAULT_SETTINGS.secondaryTimeZone).toBeNull()
    expect(result.secondaryTimeZone).toBeNull()
    // The missing-field fallback must not cost the settings that were there.
    expect(result.workMinutes).toBe(30)
    expect(result.theme).toBe('melonSoda')
  })

  it('accepts an in-range sessions per cycle', () => {
    expect(sanitizeSettings({ sessionsPerCycle: 1 }).sessionsPerCycle).toBe(1)
    expect(sanitizeSettings({ sessionsPerCycle: 10 }).sessionsPerCycle).toBe(10)
  })

  it('clamps out-of-range sessions per cycle to 1..10', () => {
    expect(sanitizeSettings({ sessionsPerCycle: 0 }).sessionsPerCycle).toBe(1)
    expect(sanitizeSettings({ sessionsPerCycle: -3 }).sessionsPerCycle).toBe(1)
    expect(sanitizeSettings({ sessionsPerCycle: 11 }).sessionsPerCycle).toBe(10)
    expect(sanitizeSettings({ sessionsPerCycle: 999 }).sessionsPerCycle).toBe(10)
  })

  it('rounds a fractional sessions per cycle', () => {
    expect(sanitizeSettings({ sessionsPerCycle: 6.6 }).sessionsPerCycle).toBe(7)
  })

  it('falls back to 4 sessions on invalid values', () => {
    expect(sanitizeSettings({ sessionsPerCycle: '6' }).sessionsPerCycle).toBe(4)
    expect(sanitizeSettings({ sessionsPerCycle: NaN }).sessionsPerCycle).toBe(4)
    expect(sanitizeSettings({ sessionsPerCycle: Infinity }).sessionsPerCycle).toBe(4)
    expect(sanitizeSettings({ sessionsPerCycle: null }).sessionsPerCycle).toBe(4)
  })

  it('defaults sessions per cycle to 4 when the field is missing (pre-feature settings file)', () => {
    const result = sanitizeSettings({ workMinutes: 30, theme: 'melonSoda' })
    expect(result.sessionsPerCycle).toBe(4)
    // The missing-field fallback must not cost the settings that were there.
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

  it('toggles clockMode and keeps other fields', () => {
    const result = applySettingsUpdate(current, { clockMode: false })
    expect(result).toEqual({ ...current, clockMode: false })
  })

  it('keeps the current clockMode on invalid patch values', () => {
    expect(applySettingsUpdate(current, { clockMode: 'off' }).clockMode).toBe(true)
  })

  it('switches the clock format and keeps other fields', () => {
    const result = applySettingsUpdate(current, { clockFormat: 'hhmm' })
    expect(result).toEqual({ ...current, clockFormat: 'hhmm' })
  })

  it('keeps the current clock format on invalid patch values', () => {
    expect(applySettingsUpdate(current, { clockFormat: 'seconds' }).clockFormat).toBe('hhmmss')
  })

  it('switches the comparison zone and keeps other fields', () => {
    const result = applySettingsUpdate(current, { secondaryTimeZone: 'Europe/Paris' })
    expect(result).toEqual({ ...current, secondaryTimeZone: 'Europe/Paris' })
  })

  it('clears the comparison zone when the patch is null', () => {
    // The "not set" choice must reach the store, not be read as "keep the current zone".
    const result = applySettingsUpdate(current, { secondaryTimeZone: null })
    expect(result).toEqual({ ...current, secondaryTimeZone: null })
  })

  it('keeps the current comparison zone on invalid patch values', () => {
    const patched = applySettingsUpdate(current, { secondaryTimeZone: 'Europe/Rome' })
    expect(patched.secondaryTimeZone).toBe('America/New_York')
  })

  it('changes the sessions per cycle and keeps other fields', () => {
    const result = applySettingsUpdate(current, { sessionsPerCycle: 2 })
    expect(result).toEqual({ ...current, sessionsPerCycle: 2 })
  })

  it('keeps the current sessions per cycle on invalid patch values', () => {
    expect(applySettingsUpdate(current, { sessionsPerCycle: 'many' }).sessionsPerCycle).toBe(6)
    expect(applySettingsUpdate(current, { sessionsPerCycle: 99 }).sessionsPerCycle).toBe(10)
  })

  it('round-trips an updated theme through the sanitizer unchanged', () => {
    const updated = applySettingsUpdate(current, { theme: 'nightPudding' })
    expect(sanitizeSettings(updated)).toEqual(updated)
  })
})

describe('asSecondaryTimeZone', () => {
  it('accepts a curated zone', () => {
    expect(asSecondaryTimeZone('Asia/Tokyo', null)).toBe('Asia/Tokyo')
  })

  it('accepts null as a valid "not set" rather than falling back', () => {
    expect(asSecondaryTimeZone(null, 'Asia/Tokyo')).toBeNull()
  })

  it('falls back on an unknown string, a number, and an uncurated IANA zone', () => {
    expect(asSecondaryTimeZone('nowhere', 'Asia/Tokyo')).toBe('Asia/Tokyo')
    expect(asSecondaryTimeZone(42, 'Asia/Tokyo')).toBe('Asia/Tokyo')
    expect(asSecondaryTimeZone('Europe/Rome', 'Asia/Tokyo')).toBe('Asia/Tokyo')
  })

  it('falls back on undefined, so a missing key is not read as "not set"', () => {
    expect(asSecondaryTimeZone(undefined, 'Asia/Tokyo')).toBe('Asia/Tokyo')
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
