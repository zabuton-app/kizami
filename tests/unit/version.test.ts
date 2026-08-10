import { describe, expect, it } from 'vitest'
import { compareVersions, isComparableVersion, normalizeVersion } from '../../src/shared/version'

describe('normalizeVersion', () => {
  it('strips a leading v regardless of case', () => {
    expect(normalizeVersion('v0.2.0')).toBe('0.2.0')
    expect(normalizeVersion('V1.0.0')).toBe('1.0.0')
    expect(normalizeVersion('0.2.0')).toBe('0.2.0')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeVersion('  v1.2.3 \n')).toBe('1.2.3')
  })
})

describe('isComparableVersion', () => {
  it('accepts dotted-numeric tags with or without the v prefix', () => {
    expect(isComparableVersion('v0.2.0')).toBe(true)
    expect(isComparableVersion('0.2.0')).toBe(true)
    expect(isComparableVersion('1.0')).toBe(true)
    expect(isComparableVersion('12')).toBe(true)
    expect(isComparableVersion('1.2.3-beta.1')).toBe(true)
  })

  it('rejects tags that would silently compare as 0.0.0', () => {
    // These would otherwise read as "you are up to date" rather than as a
    // failed check, which is the outcome the caller must see.
    expect(isComparableVersion('latest')).toBe(false)
    expect(isComparableVersion('v')).toBe(false)
    expect(isComparableVersion('nightly')).toBe(false)
    expect(isComparableVersion('1.x.0')).toBe(false)
    expect(isComparableVersion('')).toBe(false)
    expect(isComparableVersion('  ')).toBe(false)
  })
})

describe('compareVersions', () => {
  it('orders by numeric component, not lexically', () => {
    // "0.2.0" < "0.10.0" as numbers, but > as strings.
    expect(compareVersions('0.10.0', '0.2.0')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('0.1.9', '0.2.0')).toBeLessThan(0)
  })

  it('absorbs the v prefix on either side', () => {
    expect(compareVersions('v0.2.0', '0.1.0')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', 'v0.2.0')).toBeLessThan(0)
    expect(compareVersions('v1.0.0', 'v1.0.0')).toBe(0)
  })

  it('treats missing trailing components as zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0)
  })

  it('ignores any pre-release suffix', () => {
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBe(0)
    expect(compareVersions('1.3.0-rc1', '1.2.0')).toBeGreaterThan(0)
  })

  it('coerces non-numeric components to zero', () => {
    expect(compareVersions('latest', '0.0.0')).toBe(0)
    expect(compareVersions('1.x.0', '1.0.0')).toBe(0)
  })
})
