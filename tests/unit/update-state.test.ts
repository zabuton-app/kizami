import { describe, expect, it } from 'vitest'
import {
  MS_STORE_PRODUCT_ID,
  isAllowedReleaseUrl,
  isUpdateAvailable,
  msStoreProductUrl,
  sanitizeUpdateState,
  shouldSkipAutoCheck,
  updateTargetUrl
} from '../../src/shared/update-state'
import {
  DEFAULT_UPDATE_STATE,
  UPDATE_CHECK_THROTTLE_MS,
  type UpdateState
} from '../../src/shared/types'

describe('sanitizeUpdateState', () => {
  it('returns defaults for non-object input', () => {
    expect(sanitizeUpdateState(undefined)).toEqual(DEFAULT_UPDATE_STATE)
    expect(sanitizeUpdateState('broken json')).toEqual(DEFAULT_UPDATE_STATE)
    expect(sanitizeUpdateState(null)).toEqual(DEFAULT_UPDATE_STATE)
  })

  it('keeps valid values as they are', () => {
    const state: UpdateState = {
      autoCheck: false,
      skippedVersion: '0.3.0',
      lastCheckedAt: 1_700_000_000_000
    }
    expect(sanitizeUpdateState(state)).toEqual(state)
  })

  it('falls back to the default when autoCheck is not a boolean', () => {
    expect(sanitizeUpdateState({ autoCheck: 'yes' }).autoCheck).toBe(true)
    expect(sanitizeUpdateState({ autoCheck: 0 }).autoCheck).toBe(true)
  })

  it('normalizes skippedVersion and rejects unusable values', () => {
    expect(sanitizeUpdateState({ skippedVersion: 'v1.2.3' }).skippedVersion).toBe('1.2.3')
    expect(sanitizeUpdateState({ skippedVersion: '  v1.2.3  ' }).skippedVersion).toBe('1.2.3')
    expect(sanitizeUpdateState({ skippedVersion: '' }).skippedVersion).toBeNull()
    expect(sanitizeUpdateState({ skippedVersion: '   ' }).skippedVersion).toBeNull()
    expect(sanitizeUpdateState({ skippedVersion: 42 }).skippedVersion).toBeNull()
  })

  it('rejects a lastCheckedAt that is not a usable timestamp', () => {
    expect(sanitizeUpdateState({ lastCheckedAt: -1 }).lastCheckedAt).toBeNull()
    expect(sanitizeUpdateState({ lastCheckedAt: Number.NaN }).lastCheckedAt).toBeNull()
    expect(
      sanitizeUpdateState({ lastCheckedAt: Number.POSITIVE_INFINITY }).lastCheckedAt
    ).toBeNull()
    expect(sanitizeUpdateState({ lastCheckedAt: '2026-01-01' }).lastCheckedAt).toBeNull()
    expect(sanitizeUpdateState({ lastCheckedAt: 0 }).lastCheckedAt).toBe(0)
  })
})

describe('shouldSkipAutoCheck', () => {
  const now = 1_700_000_000_000
  const at = (lastCheckedAt: number | null): UpdateState => ({
    ...DEFAULT_UPDATE_STATE,
    lastCheckedAt
  })

  it('runs the check when nothing has been recorded yet', () => {
    expect(shouldSkipAutoCheck(at(null), now)).toBe(false)
  })

  it('skips while inside the throttle window', () => {
    expect(shouldSkipAutoCheck(at(now), now)).toBe(true)
    expect(shouldSkipAutoCheck(at(now - UPDATE_CHECK_THROTTLE_MS + 1), now)).toBe(true)
  })

  it('runs once the throttle window has elapsed', () => {
    expect(shouldSkipAutoCheck(at(now - UPDATE_CHECK_THROTTLE_MS), now)).toBe(false)
    expect(shouldSkipAutoCheck(at(now - UPDATE_CHECK_THROTTLE_MS - 1), now)).toBe(false)
  })

  it('runs when the clock has moved backwards', () => {
    // A future timestamp means elapsed time is unknowable; fail towards checking.
    expect(shouldSkipAutoCheck(at(now + 60_000), now)).toBe(false)
  })
})

describe('isUpdateAvailable', () => {
  it('is true only when the latest version is strictly newer', () => {
    expect(isUpdateAvailable('0.2.0', '0.1.0', null)).toBe(true)
    expect(isUpdateAvailable('0.1.0', '0.1.0', null)).toBe(false)
    // A dev build ahead of the published release is not an update.
    expect(isUpdateAvailable('0.1.0', '0.2.0', null)).toBe(false)
  })

  it('absorbs the v prefix on either side', () => {
    expect(isUpdateAvailable('v0.2.0', '0.1.0', null)).toBe(true)
    expect(isUpdateAvailable('0.2.0', 'v0.2.0', null)).toBe(false)
  })

  it('suppresses a version the user skipped', () => {
    expect(isUpdateAvailable('0.2.0', '0.1.0', '0.2.0')).toBe(false)
    expect(isUpdateAvailable('0.2.0', '0.1.0', 'v0.2.0')).toBe(false)
  })

  it('still reports versions newer than the skipped one', () => {
    expect(isUpdateAvailable('0.3.0', '0.1.0', '0.2.0')).toBe(true)
  })

  it('ignores a skipped version older than the latest', () => {
    expect(isUpdateAvailable('0.2.0', '0.1.0', '0.1.5')).toBe(true)
  })
})

describe('isAllowedReleaseUrl', () => {
  it('accepts github.com release links over https', () => {
    expect(isAllowedReleaseUrl('https://github.com/zabuton-app/kizami/releases/tag/v0.2.0')).toBe(
      true
    )
    expect(isAllowedReleaseUrl('https://www.github.com/zabuton-app/kizami/releases')).toBe(true)
  })

  it('rejects any other host', () => {
    expect(isAllowedReleaseUrl('https://example.com/malicious')).toBe(false)
    // Suffix and subdomain lookalikes must not pass.
    expect(isAllowedReleaseUrl('https://evil-github.com/x')).toBe(false)
    expect(isAllowedReleaseUrl('https://github.com.evil.test/x')).toBe(false)
  })

  it('rejects non-https schemes', () => {
    expect(isAllowedReleaseUrl('http://github.com/zabuton-app/kizami')).toBe(false)
    expect(isAllowedReleaseUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedReleaseUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects values that are not usable URLs', () => {
    expect(isAllowedReleaseUrl('not a url')).toBe(false)
    expect(isAllowedReleaseUrl('')).toBe(false)
    expect(isAllowedReleaseUrl(null)).toBe(false)
    expect(isAllowedReleaseUrl(undefined)).toBe(false)
    expect(isAllowedReleaseUrl(42)).toBe(false)
  })
})

describe('updateTargetUrl', () => {
  const releaseUrl = 'https://github.com/zabuton-app/kizami/releases/tag/v0.2.0'

  it('sends non-Store builds to the GitHub release page', () => {
    expect(updateTargetUrl(releaseUrl, false)).toBe(releaseUrl)
  })

  it('sends Store builds to the Store product page once a listing exists', () => {
    const storeUrl = msStoreProductUrl()
    if (MS_STORE_PRODUCT_ID === null) {
      // No Store listing yet: the only sane target is still the release page.
      expect(storeUrl).toBeNull()
      expect(updateTargetUrl(releaseUrl, true)).toBe(releaseUrl)
    } else {
      expect(storeUrl).toBe(`ms-windows-store://pdp/?ProductId=${MS_STORE_PRODUCT_ID}`)
      expect(updateTargetUrl(releaseUrl, true)).toBe(storeUrl)
    }
  })
})
