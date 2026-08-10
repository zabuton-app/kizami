import { app } from 'electron'
import Store from 'electron-store'
import { applySettingsUpdate, detectLanguage, sanitizeSettings } from '../shared/settings'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'

/**
 * Persistent settings backed by a JSON file in `userData`.
 * All values pass through the shared sanitizer, so corrupted or out-of-range
 * data on disk can never reach the rest of the app.
 */
export class SettingsStore {
  private readonly store = new Store<{ settings: Settings }>({ name: 'settings' })
  private current: Settings

  constructor() {
    const firstRunDefaults: Settings = {
      ...DEFAULT_SETTINGS,
      language: detectLanguage(app.getLocale())
    }
    this.current = sanitizeSettings(this.store.get('settings'), firstRunDefaults)
    this.store.set('settings', this.current)
  }

  get(): Settings {
    return this.current
  }

  update(patch: unknown): Settings {
    this.current = applySettingsUpdate(this.current, patch)
    this.store.set('settings', this.current)
    return this.current
  }
}
