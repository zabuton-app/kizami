/**
 * Keyboard shortcuts for the timer controls, as a pure key-to-action mapping so
 * it can be tested without a DOM. Where the event came from (a text field, a
 * keyboard-focused button) is App's concern; this only decides what a key means.
 *
 * - Timer mode (pomodoro): Space starts / pauses / resumes, S skips the phase.
 * - Clock mode (countdown): Space pauses / resumes, R resets to full, paused.
 */

export type ShortcutAction = 'toggle' | 'skip' | 'reset'

/** The subset of a KeyboardEvent the mapping reads. */
export interface ShortcutKeyEvent {
  readonly key: string
  readonly code: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly isComposing: boolean
}

/** Values for `aria-keyshortcuts` and the tooltip hints. */
export const SHORTCUT_KEYS = {
  toggle: 'Space',
  skip: 'S',
  reset: 'R'
} as const

/** A control's label with its shortcut appended, for tooltips. */
export function withShortcutHint(label: string, key: string): string {
  return `${label} (${key})`
}

export function shortcutFor(event: ShortcutKeyEvent, clockMode: boolean): ShortcutAction | null {
  // Modified keys belong to the app and the OS (Ctrl+R reload, Ctrl+wheel
  // zoom, ...), and a key that is part of an IME conversion is text, not a
  // command. Auto-repeat is still mapped: App has to swallow a held Space's
  // repeats (or a focused button fires on key up) while acting only once.
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
    return null
  }
  if (event.key === ' ' || event.code === 'Space') return 'toggle'
  const key = event.key.toLowerCase()
  if (clockMode) {
    return key === 'r' ? 'reset' : null
  }
  return key === 's' ? 'skip' : null
}
