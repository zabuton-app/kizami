import { describe, expect, it } from 'vitest'
import { en, ja, t } from '../../src/shared/i18n'

describe('i18n dictionaries', () => {
  it('ja and en cover exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort())
  })

  it('has no empty messages', () => {
    for (const dict of [ja, en]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value, `empty message for ${key}`).not.toBe('')
      }
    }
  })

  it('resolves messages per language', () => {
    expect(t('ja', 'phase.work')).toBe('しゅうちゅうタイム')
    expect(t('en', 'phase.work')).toBe('Focus Time')
    expect(t('ja', 'timer.skip')).toBe('スキップ')
    expect(t('en', 'timer.skip')).toBe('Skip')
  })
})
