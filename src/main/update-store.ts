import Store from 'electron-store'
import { sanitizeUpdateState } from '../shared/update-state'
import { normalizeVersion } from '../shared/version'
import { type UpdateState } from '../shared/types'

/**
 * Persistent update-check state, kept in its own file rather than in
 * `settings.json`. `lastCheckedAt` backs the throttle that limits how often we
 * reach out to GitHub, so it must not be reachable from the renderer the way
 * settings are.
 */
export class UpdateStore {
  private readonly store = new Store<{ update: UpdateState }>({ name: 'update' })
  private current: UpdateState

  constructor() {
    this.current = sanitizeUpdateState(this.store.get('update'))
    this.store.set('update', this.current)
  }

  get(): UpdateState {
    return this.current
  }

  setAutoCheck(enabled: boolean): UpdateState {
    return this.write({ autoCheck: enabled })
  }

  setSkippedVersion(version: string | null): UpdateState {
    return this.write({
      skippedVersion: version === null ? null : normalizeVersion(version)
    })
  }

  /** Record a successful round-trip. Only successes feed the throttle. */
  markChecked(at: number): UpdateState {
    return this.write({ lastCheckedAt: at })
  }

  private write(patch: Partial<UpdateState>): UpdateState {
    this.current = sanitizeUpdateState({ ...this.current, ...patch })
    this.store.set('update', this.current)
    return this.current
  }
}
