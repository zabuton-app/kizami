import { describe, expect, it } from 'vitest'
import { en, ja, t } from '../../src/shared/i18n'

const WORLD_CLOCK_KEYS = [
  'timezone.tokyo',
  'timezone.seoul',
  'timezone.shanghai',
  'timezone.taipei',
  'timezone.hongKong',
  'timezone.singapore',
  'timezone.bangkok',
  'timezone.jakarta',
  'timezone.delhi',
  'timezone.dubai',
  'timezone.london',
  'timezone.paris',
  'timezone.berlin',
  'timezone.madrid',
  'timezone.moscow',
  'timezone.newYork',
  'timezone.toronto',
  'timezone.chicago',
  'timezone.denver',
  'timezone.losAngeles',
  'timezone.mexicoCity',
  'timezone.saoPaulo',
  'timezone.sydney',
  'timezone.auckland',
  'timezone.honolulu',
  'timezone.utc',
  'timezone.region.asia',
  'timezone.region.europe',
  'timezone.region.americas',
  'timezone.region.oceania',
  'timezone.region.utc',
  'settings.secondaryTimeZone',
  'timezone.none',
  'clock.home',
  'clock.hourUnit'
]

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

  it('covers every world clock label', () => {
    const jaKeys = Object.keys(ja)
    for (const key of WORLD_CLOCK_KEYS) {
      expect(jaKeys, `missing world clock key ${key}`).toContain(key)
    }
  })

  it('uses the same short hour unit in both languages', () => {
    expect(t('ja', 'clock.hourUnit')).toBe('h')
    expect(t('en', 'clock.hourUnit')).toBe('h')
  })

  it('resolves messages per language', () => {
    expect(t('ja', 'phase.work')).toBe('しゅうちゅうタイム')
    expect(t('en', 'phase.work')).toBe('Focus Time')
    expect(t('ja', 'timer.skip')).toBe('スキップ')
    expect(t('en', 'timer.skip')).toBe('Skip')
  })
})
