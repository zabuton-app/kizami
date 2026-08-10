// Update check against GitHub Releases. Notification-only: nothing here ever
// downloads or installs. We compare the running version against the latest
// published *stable* release and report whether a newer one exists.
//
// `/releases/latest` is defined by GitHub as the most recent non-draft,
// non-prerelease release, so prereleases are filtered server-side.
import { app, net } from 'electron'
import {
  isAllowedReleaseUrl,
  isUpdateAvailable,
  shouldSkipAutoCheck,
  updateTargetUrl
} from '../shared/update-state'
import { isComparableVersion, normalizeVersion } from '../shared/version'
import type { UpdateCheckResult, UpdateStatus } from '../shared/types'
import type { UpdateStore } from './update-store'

const REPO_OWNER = 'zabuton-app'
const REPO_NAME = 'kizami'

const REQUEST_TIMEOUT_MS = 10_000

/**
 * Target repo as `owner/name`. In development only, KIZAMI_UPDATE_REPO overrides
 * it so the flow can be exercised against a throwaway public repo. Ignored in
 * packaged builds so a stray env var can never point release users elsewhere.
 */
function resolveRepo(): { owner: string; name: string } {
  // Only honour the override when a dev build is positively confirmed. If
  // `isPackaged` is undefined for any reason, fall through to the real repo.
  if (app?.isPackaged === false) {
    const match = process.env.KIZAMI_UPDATE_REPO?.trim().match(/^([\w.-]+)\/([\w.-]+)$/)
    if (match) {
      console.log(`updater: using repo override ${match[1]}/${match[2]}`)
      return { owner: match[1], name: match[2] }
    }
  }
  return { owner: REPO_OWNER, name: REPO_NAME }
}

function latestReleaseApi(): string {
  const { owner, name } = resolveRepo()
  return `https://api.github.com/repos/${owner}/${name}/releases/latest`
}

function releasesPage(): string {
  const { owner, name } = resolveRepo()
  return `https://github.com/${owner}/${name}/releases`
}

interface GithubRelease {
  tag_name?: string
  name?: string
  html_url?: string
  published_at?: string
}

/**
 * The release page to send the user to. `html_url` comes from the API response,
 * so anything that fails the allow-list falls back to the releases list — the
 * renderer must never be handed a link we would refuse to open ourselves.
 */
function releaseUrl(htmlUrl: unknown): string {
  return isAllowedReleaseUrl(htmlUrl) ? (htmlUrl as string) : releasesPage()
}

/**
 * Fetch the latest stable release. Uses Electron's `net` so the system proxy and
 * certificate store are honoured. Rejects on any failure; callers turn that into
 * a null result rather than letting it escape.
 */
function fetchLatestRelease(): Promise<GithubRelease> {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url: latestReleaseApi() })
    request.setHeader('Accept', 'application/vnd.github+json')
    request.setHeader('User-Agent', `kizami/${app.getVersion()}`)

    // Every exit runs through settle(), so the timeout is cleared exactly once
    // and a late event after a decision can never re-resolve the promise. The
    // timer stays armed until then: a response whose body stalls mid-stream must
    // still time out rather than hang the check forever.
    let settled = false
    const settle = (error: Error | null, release?: GithubRelease): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        request.abort()
        reject(error)
      } else {
        resolve(release as GithubRelease)
      }
    }

    const timer = setTimeout(() => settle(new Error('update check timed out')), REQUEST_TIMEOUT_MS)

    request.on('response', (response) => {
      // The response stream emits its own errors (connection dropped mid-body).
      // Unhandled, those surface as an uncaught exception in the main process.
      response.on('error', (error: Error) => settle(error))
      response.on('aborted', () => settle(new Error('update check aborted')))

      if (response.statusCode !== 200) {
        // Drain so the socket can close, but fail immediately — the body of an
        // error response is of no use to us.
        response.on('data', () => {})
        settle(new Error(`GitHub API returned ${response.statusCode}`))
        return
      }

      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        try {
          settle(null, JSON.parse(Buffer.concat(chunks).toString('utf8')) as GithubRelease)
        } catch (error) {
          settle(error instanceof Error ? error : new Error(String(error)))
        }
      })
    })

    request.on('error', (error) => settle(error))
    request.end()
  })
}

/**
 * Owns the update-check flow and the most recent verdict. The verdict is held in
 * memory so the renderer can ask for it at any point — a startup check may
 * finish before or after the popup mounts.
 */
export class Updater {
  private latestResult: UpdateCheckResult | null = null
  private inFlight: Promise<UpdateCheckResult | null> | null = null

  constructor(private readonly store: UpdateStore) {}

  /**
   * Check GitHub for a newer stable release.
   *
   * Returns null when the check could not complete (offline, timeout, non-200,
   * malformed body, missing tag) or was skipped by the throttle — callers must
   * keep that distinct from "no update" (`available: false`). `force` bypasses
   * the throttle and is what the manual button uses.
   *
   * Concurrent calls share one request. Pressing "check now" while the startup
   * check is still running would otherwise race, and whichever finished last
   * would win — which can mean an older response overwriting a newer one.
   */
  check(opts: { force?: boolean } = {}): Promise<UpdateCheckResult | null> {
    if (!opts.force && shouldSkipAutoCheck(this.store.get(), Date.now())) {
      console.log('updater: throttled; skipping check')
      return Promise.resolve(null)
    }
    this.inFlight ??= this.run().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async run(): Promise<UpdateCheckResult | null> {
    let release: GithubRelease
    try {
      release = await fetchLatestRelease()
    } catch (error) {
      console.warn('updater: check failed:', error)
      return null
    }

    // `JSON.parse` happily yields null or a primitive for a well-formed body
    // that is not an object, so the shape is checked before any property read.
    if (typeof release !== 'object' || release === null) {
      console.warn('updater: latest release response was not an object')
      return null
    }

    const tag = typeof release.tag_name === 'string' ? release.tag_name : null
    if (!tag || !isComparableVersion(tag)) {
      console.warn('updater: latest release has no comparable tag_name:', tag)
      return null
    }

    // Only a completed round-trip counts towards the throttle.
    this.store.markChecked(Date.now())

    const current = app.getVersion()
    const latest = normalizeVersion(tag)
    const result: UpdateCheckResult = {
      current,
      latest,
      available: isUpdateAvailable(latest, current, this.store.get().skippedVersion),
      url: updateTargetUrl(releaseUrl(release.html_url), process.windowsStore === true),
      name: typeof release.name === 'string' ? release.name : null,
      publishedAt: typeof release.published_at === 'string' ? release.published_at : null
    }
    this.latestResult = result
    return result
  }

  /** Current state for the renderer: version, toggle, and the latest verdict. */
  getStatus(): UpdateStatus {
    const { autoCheck } = this.store.get()
    const result = this.latestResult
    const available = result?.available === true
    return {
      currentVersion: app.getVersion(),
      autoCheck,
      available,
      latestVersion: available ? result.latest : null,
      url: available ? result.url : null
    }
  }

  setAutoCheck(enabled: boolean): UpdateStatus {
    this.store.setAutoCheck(enabled)
    return this.getStatus()
  }

  isAutoCheckEnabled(): boolean {
    return this.store.get().autoCheck
  }

  /** Mark a version as skipped and re-evaluate the held verdict. */
  skipVersion(version: string): UpdateStatus {
    const { skippedVersion } = this.store.setSkippedVersion(version)
    if (this.latestResult) {
      this.latestResult = {
        ...this.latestResult,
        available: isUpdateAvailable(
          this.latestResult.latest,
          this.latestResult.current,
          skippedVersion
        )
      }
    }
    return this.getStatus()
  }
}
