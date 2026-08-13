import { DEFAULT_UPDATE_STATE, UPDATE_CHECK_THROTTLE_MS, type UpdateState } from './types'
import { compareVersions, normalizeVersion } from './version'

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asSkippedVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = normalizeVersion(value)
  return normalized === '' ? null : normalized
}

function asTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return value
}

/**
 * Coerce arbitrary (possibly corrupted) data into a valid UpdateState.
 * Mirrors `sanitizeSettings`: wrong types fall back to defaults rather than
 * propagating into the rest of the app.
 */
export function sanitizeUpdateState(input: unknown): UpdateState {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  return {
    autoCheck: asBoolean(raw.autoCheck, DEFAULT_UPDATE_STATE.autoCheck),
    skippedVersion: asSkippedVersion(raw.skippedVersion),
    lastCheckedAt: asTimestamp(raw.lastCheckedAt)
  }
}

/**
 * Whether a startup check should be skipped because one succeeded recently.
 * A timestamp in the future means the clock moved; elapsed time is then
 * unknowable, so we check rather than stay silent for up to six hours.
 * Manual checks bypass this entirely.
 */
export function shouldSkipAutoCheck(state: UpdateState, now: number): boolean {
  if (state.lastCheckedAt === null) return false
  const elapsed = now - state.lastCheckedAt
  return elapsed >= 0 && elapsed < UPDATE_CHECK_THROTTLE_MS
}

/**
 * Whether a URL is safe to hand to the OS browser for this feature. Release
 * links originate from the GitHub API response and then cross the IPC boundary,
 * so neither end is trusted: only https github.com URLs qualify.
 */
export function isAllowedReleaseUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  return parsed.hostname === 'github.com' || parsed.hostname === 'www.github.com'
}

/**
 * Microsoft Store product ID (Partner Center → Product identity). Typed as
 * nullable so the no-listing path stays exercised for apps that have not been
 * submitted yet.
 */
export const MS_STORE_PRODUCT_ID: string | null = '9NQLKSMBFKH0'

/** Store product page URL, or null when no Store listing exists yet. */
export function msStoreProductUrl(): string | null {
  return MS_STORE_PRODUCT_ID === null
    ? null
    : `ms-windows-store://pdp/?ProductId=${MS_STORE_PRODUCT_ID}`
}

/**
 * Where the "view this update" action should send the user. Store-installed
 * builds (`process.windowsStore`) go to the Store product page — the Store
 * itself applies their updates — while every other channel (GitHub Release
 * direct download, AUR) goes to the GitHub release page.
 */
export function updateTargetUrl(releasePageUrl: string, isWindowsStore: boolean): string {
  return (isWindowsStore ? msStoreProductUrl() : null) ?? releasePageUrl
}

/** Whether `latest` should be surfaced: strictly newer, and not the skipped one. */
export function isUpdateAvailable(
  latest: string,
  current: string,
  skippedVersion: string | null
): boolean {
  if (compareVersions(latest, current) <= 0) return false
  if (skippedVersion === null) return true
  return compareVersions(latest, skippedVersion) !== 0
}
