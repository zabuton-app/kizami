import { describe, expect, it } from 'vitest'
import { groupByRegion } from '../../src/renderer/components/TimezoneSelect'
import { TIMEZONE_OPTIONS, TIMEZONE_REGIONS, type TimezoneOption } from '../../src/shared/timezones'

describe('groupByRegion', () => {
  it('lists groups in TIMEZONE_REGIONS order', () => {
    const groups = groupByRegion(TIMEZONE_OPTIONS)
    expect(groups.map((group) => group.region)).toEqual([...TIMEZONE_REGIONS])
  })

  // The control must offer exactly the catalog: an entry that no group carries
  // would be a city the user can never pick back after an upgrade.
  it('places every catalog entry in exactly one group, in catalog order', () => {
    const groups = groupByRegion(TIMEZONE_OPTIONS)
    expect(groups.flatMap((group) => group.options)).toEqual([...TIMEZONE_OPTIONS])
  })

  it('groups only the entries belonging to the region', () => {
    for (const group of groupByRegion(TIMEZONE_OPTIONS)) {
      expect(group.options.every((option) => option.region === group.region)).toBe(true)
      expect(group.options.length).toBeGreaterThan(0)
    }
  })

  // A region left without cities would otherwise render an empty `optgroup`,
  // which reads as a group heading with nothing under it.
  it('drops a region that has no entries', () => {
    const onlyUtc: readonly TimezoneOption[] = TIMEZONE_OPTIONS.filter(
      (option) => option.region === 'utc'
    )
    expect(groupByRegion(onlyUtc).map((group) => group.region)).toEqual(['utc'])
  })
})
