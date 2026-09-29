import { describe, expect, it } from 'vitest'
import { shortcutFor, type ShortcutKeyEvent } from '../../src/renderer/shortcuts'

function key(
  key: string,
  code: string,
  overrides: Partial<ShortcutKeyEvent> = {}
): ShortcutKeyEvent {
  return {
    key,
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    ...overrides
  }
}

const SPACE = key(' ', 'Space')
const R = key('r', 'KeyR')
const S = key('s', 'KeyS')

describe('shortcutFor in timer (pomodoro) mode', () => {
  it('maps Space to toggle and S to skip', () => {
    expect(shortcutFor(SPACE, false)).toBe('toggle')
    expect(shortcutFor(S, false)).toBe('skip')
    expect(shortcutFor(key('S', 'KeyS', { key: 'S' }), false)).toBe('skip')
  })

  it('has no reset: the pomodoro timer only toggles and skips', () => {
    expect(shortcutFor(R, false)).toBeNull()
  })
})

describe('shortcutFor in clock mode', () => {
  it('maps Space to toggle and R to reset', () => {
    expect(shortcutFor(SPACE, true)).toBe('toggle')
    expect(shortcutFor(R, true)).toBe('reset')
    expect(shortcutFor(key('R', 'KeyR'), true)).toBe('reset')
  })

  it('has no skip: a countdown has no next phase', () => {
    expect(shortcutFor(S, true)).toBeNull()
  })
})

describe('shortcutFor ignores keys that are not plain presses', () => {
  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
    ['Alt', { altKey: true }],
    ['IME composition', { isComposing: true }]
  ])('%s', (_name, overrides) => {
    for (const clockMode of [false, true]) {
      expect(shortcutFor({ ...SPACE, ...overrides }, clockMode)).toBeNull()
      expect(shortcutFor({ ...R, ...overrides }, clockMode)).toBeNull()
      expect(shortcutFor({ ...S, ...overrides }, clockMode)).toBeNull()
    }
  })

  it('recognises Space by its physical code when the key value differs', () => {
    expect(shortcutFor(key('Process', 'Space'), false)).toBe('toggle')
  })

  it('ignores every other key', () => {
    expect(shortcutFor(key('Enter', 'Enter'), false)).toBeNull()
    expect(shortcutFor(key('Escape', 'Escape'), true)).toBeNull()
    expect(shortcutFor(key('ArrowUp', 'ArrowUp'), true)).toBeNull()
  })
})
