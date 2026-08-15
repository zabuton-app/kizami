import { describe, expect, it } from 'vitest'
import { t, type MessageKey } from '../../src/shared/i18n'
import {
  isCuratedZone,
  TIMEZONE_OPTIONS,
  TIMEZONE_REGIONS,
  type CuratedZone,
  type TimezoneOption,
  type TimezoneRegion
} from '../../src/shared/timezones'

// The curated list is a product decision, not a derivation, so transcribe it
// here independently: a dropped or repaired entry has to be a deliberate edit
// in two places rather than a silent drift in one.
const EXPECTED: readonly TimezoneOption[] = [
  { zone: 'Asia/Tokyo', labelKey: 'timezone.tokyo', region: 'asia' },
  { zone: 'Asia/Seoul', labelKey: 'timezone.seoul', region: 'asia' },
  { zone: 'Asia/Shanghai', labelKey: 'timezone.shanghai', region: 'asia' },
  { zone: 'Asia/Taipei', labelKey: 'timezone.taipei', region: 'asia' },
  { zone: 'Asia/Hong_Kong', labelKey: 'timezone.hongKong', region: 'asia' },
  { zone: 'Asia/Singapore', labelKey: 'timezone.singapore', region: 'asia' },
  { zone: 'Asia/Bangkok', labelKey: 'timezone.bangkok', region: 'asia' },
  { zone: 'Asia/Jakarta', labelKey: 'timezone.jakarta', region: 'asia' },
  // Delhi deliberately pairs with Asia/Kolkata: same offset, customary city name.
  { zone: 'Asia/Kolkata', labelKey: 'timezone.delhi', region: 'asia' },
  { zone: 'Asia/Dubai', labelKey: 'timezone.dubai', region: 'asia' },
  { zone: 'Europe/London', labelKey: 'timezone.london', region: 'europe' },
  { zone: 'Europe/Paris', labelKey: 'timezone.paris', region: 'europe' },
  { zone: 'Europe/Berlin', labelKey: 'timezone.berlin', region: 'europe' },
  { zone: 'Europe/Madrid', labelKey: 'timezone.madrid', region: 'europe' },
  { zone: 'Europe/Moscow', labelKey: 'timezone.moscow', region: 'europe' },
  { zone: 'America/New_York', labelKey: 'timezone.newYork', region: 'americas' },
  { zone: 'America/Toronto', labelKey: 'timezone.toronto', region: 'americas' },
  { zone: 'America/Chicago', labelKey: 'timezone.chicago', region: 'americas' },
  { zone: 'America/Denver', labelKey: 'timezone.denver', region: 'americas' },
  { zone: 'America/Los_Angeles', labelKey: 'timezone.losAngeles', region: 'americas' },
  { zone: 'America/Mexico_City', labelKey: 'timezone.mexicoCity', region: 'americas' },
  { zone: 'America/Sao_Paulo', labelKey: 'timezone.saoPaulo', region: 'americas' },
  { zone: 'Australia/Sydney', labelKey: 'timezone.sydney', region: 'oceania' },
  { zone: 'Pacific/Auckland', labelKey: 'timezone.auckland', region: 'oceania' },
  { zone: 'Pacific/Honolulu', labelKey: 'timezone.honolulu', region: 'oceania' },
  { zone: 'UTC', labelKey: 'timezone.utc', region: 'utc' }
]

// Group headings the select renders above each region block.
const REGION_LABEL_KEYS: Record<TimezoneRegion, MessageKey> = {
  asia: 'timezone.region.asia',
  europe: 'timezone.region.europe',
  americas: 'timezone.region.americas',
  oceania: 'timezone.region.oceania',
  utc: 'timezone.region.utc'
}

describe('TIMEZONE_OPTIONS', () => {
  it('holds between 20 and 30 entries (requirement 1.1)', () => {
    expect(TIMEZONE_OPTIONS.length).toBeGreaterThanOrEqual(20)
    expect(TIMEZONE_OPTIONS.length).toBeLessThanOrEqual(30)
  })

  it('matches the curated list entry for entry', () => {
    expect(TIMEZONE_OPTIONS).toEqual(EXPECTED)
  })

  it('ships the designed regional distribution', () => {
    const counts = TIMEZONE_REGIONS.map(
      (region) => TIMEZONE_OPTIONS.filter((option) => option.region === region).length
    )
    expect(counts).toEqual([10, 5, 7, 3, 1])
  })

  it('covers all five regions with no empty group', () => {
    const regions = new Set<string>(TIMEZONE_OPTIONS.map((option) => option.region))
    expect([...regions].sort()).toEqual(['americas', 'asia', 'europe', 'oceania', 'utc'])
  })

  it('has unique zones and unique label keys', () => {
    const zones = TIMEZONE_OPTIONS.map((option) => option.zone)
    const labelKeys = TIMEZONE_OPTIONS.map((option) => option.labelKey)
    expect(new Set(zones).size).toBe(zones.length)
    expect(new Set(labelKeys).size).toBe(labelKeys.length)
  })

  // The select renders the list top to bottom under region headings, so a
  // region that reappears after another would split into two headings.
  it('lists each region as one contiguous block in TIMEZONE_REGIONS order', () => {
    const blocks: TimezoneRegion[] = []
    for (const option of TIMEZONE_OPTIONS) {
      if (blocks[blocks.length - 1] !== option.region) {
        blocks.push(option.region)
      }
    }
    expect(blocks).toEqual([...TIMEZONE_REGIONS])
  })

  it.each(EXPECTED.map((option) => [option.zone] as const))(
    '%s resolves as an Intl time zone',
    (zone) => {
      // Node's ICU canonicalises some ids (Asia/Kolkata reports as
      // Asia/Calcutta), so assert that the zone is accepted and formats,
      // not that it round-trips byte for byte.
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: zone })).not.toThrow()
      const formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: zone,
        hour: '2-digit',
        hour12: false
      }).format(new Date('2026-08-15T12:00:00Z'))
      expect(formatted).toMatch(/\d{2}/)
    }
  )

  it('labels every entry in both languages', () => {
    for (const option of TIMEZONE_OPTIONS) {
      expect(t('ja', option.labelKey), `ja label for ${option.zone}`).not.toBe('')
      expect(t('en', option.labelKey), `en label for ${option.zone}`).not.toBe('')
    }
  })
})

describe('TIMEZONE_REGIONS', () => {
  it('lists the five regions in display order', () => {
    expect([...TIMEZONE_REGIONS]).toEqual(['asia', 'europe', 'americas', 'oceania', 'utc'])
  })

  it('labels every region group in both languages', () => {
    for (const region of TIMEZONE_REGIONS) {
      expect(t('ja', REGION_LABEL_KEYS[region]), `ja heading for ${region}`).not.toBe('')
      expect(t('en', REGION_LABEL_KEYS[region]), `en heading for ${region}`).not.toBe('')
    }
  })
})

describe('isCuratedZone', () => {
  it('accepts every curated zone', () => {
    for (const option of TIMEZONE_OPTIONS) {
      expect(isCuratedZone(option.zone), option.zone).toBe(true)
    }
  })

  it('rejects a valid but uncurated IANA zone', () => {
    expect(isCuratedZone('Europe/Rome')).toBe(false)
    expect(isCuratedZone('Asia/Calcutta')).toBe(false)
  })

  it('rejects strings that are not zones', () => {
    expect(isCuratedZone('')).toBe(false)
    expect(isCuratedZone('tokyo')).toBe(false)
    expect(isCuratedZone('asia/tokyo')).toBe(false)
  })

  it('rejects non-string values', () => {
    expect(isCuratedZone(9)).toBe(false)
    expect(isCuratedZone(null)).toBe(false)
    expect(isCuratedZone(undefined)).toBe(false)
    expect(isCuratedZone({ zone: 'Asia/Tokyo' })).toBe(false)
    expect(isCuratedZone(['Asia/Tokyo'])).toBe(false)
  })

  it('keeps CuratedZone a literal union rather than a widened string', () => {
    // The @ts-expect-error below is the assertion: it stops erroring — and so
    // fails typecheck as unused — the moment CuratedZone widens to string.
    // @ts-expect-error an arbitrary string must not be assignable to CuratedZone
    const uncurated: CuratedZone = 'Europe/Rome' as string
    expect(isCuratedZone(uncurated)).toBe(false)
  })
})
