import { app, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ABOUT_URLS, type AboutInfo } from '../shared/about'
import { isClockTimerPresetId } from '../shared/clock-timer'
import { IPC } from '../shared/types'
import { isAllowedReleaseUrl, msStoreProductUrl } from '../shared/update-state'
import { isComparableVersion } from '../shared/version'
import type { ClockTimerEngine } from './clock-timer-engine'
import { APP_RENDERER_ORIGIN, applyMiniMode } from './popup-window'
import type { SettingsStore } from './settings-store'
import type { TimerEngine } from './timer-engine'
import type { Updater } from './updater'

function isTrustedRendererUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  const isAppRenderer =
    url.protocol === 'app:' &&
    url.hostname === new URL(APP_RENDERER_ORIGIN).hostname &&
    url.port === '' &&
    url.username === '' &&
    url.password === ''

  if (app.isPackaged) return isAppRenderer

  const developmentUrl = process.env.ELECTRON_RENDERER_URL
  if (!developmentUrl) return isAppRenderer
  try {
    return url.origin === new URL(developmentUrl).origin
  } catch {
    return false
  }
}

function assertTrustedSender(event: IpcMainInvokeEvent, popup: BrowserWindow): void {
  const frame = event.senderFrame
  if (
    frame === null ||
    popup.isDestroyed() ||
    event.sender !== popup.webContents ||
    frame !== popup.webContents.mainFrame ||
    !isTrustedRendererUrl(frame.url)
  ) {
    throw new Error('IPC request rejected: untrusted renderer')
  }
}

function isAllowedExternalReleaseUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  // Store builds are handed the Store product page instead of a GitHub URL
  // (see updateTargetUrl); accept exactly that one, and only in a Store build.
  if (process.windowsStore === true && url === msStoreProductUrl()) return true
  if (!isAllowedReleaseUrl(url)) return false
  if (!app.isPackaged) return true
  const pathname = new URL(url).pathname
  return (
    pathname === '/zabuton-app/kizami/releases' ||
    pathname.startsWith('/zabuton-app/kizami/releases/')
  )
}

/**
 * Register all IPC handlers and wire engine updates to the renderer.
 * Snapshots are only pushed while the popup is visible.
 */
export function registerIpc(
  engine: TimerEngine,
  clockTimer: ClockTimerEngine,
  settingsStore: SettingsStore,
  updater: Updater,
  popup: BrowserWindow
): void {
  ipcMain.handle(IPC.timerGetSnapshot, (event) => {
    assertTrustedSender(event, popup)
    return engine.snapshot()
  })
  ipcMain.handle(IPC.timerToggle, (event) => {
    assertTrustedSender(event, popup)
    return engine.toggle()
  })
  ipcMain.handle(IPC.timerSkip, (event) => {
    assertTrustedSender(event, popup)
    return engine.skip()
  })

  ipcMain.handle(IPC.clockTimerGetSnapshot, (event) => {
    assertTrustedSender(event, popup)
    return clockTimer.snapshot()
  })
  // The preset id crosses from the renderer, so it is validated here against
  // the shared preset list; anything unknown is a no-op, mirroring how
  // update:skip treats a bad version string.
  ipcMain.handle(IPC.clockTimerStart, (event, presetId: unknown) => {
    assertTrustedSender(event, popup)
    if (!isClockTimerPresetId(presetId)) {
      return clockTimer.snapshot()
    }
    return clockTimer.start(presetId)
  })
  ipcMain.handle(IPC.clockTimerCancel, (event) => {
    assertTrustedSender(event, popup)
    return clockTimer.cancel()
  })
  ipcMain.handle(IPC.clockTimerDismiss, (event) => {
    assertTrustedSender(event, popup)
    return clockTimer.dismiss()
  })

  ipcMain.handle(IPC.settingsGet, (event) => {
    assertTrustedSender(event, popup)
    return settingsStore.get()
  })

  ipcMain.handle(IPC.settingsUpdate, (event, patch: unknown) => {
    assertTrustedSender(event, popup)
    const previous = settingsStore.get()
    const next = settingsStore.update(patch)
    engine.applySettingsChange(next)
    if (previous.miniMode !== next.miniMode) {
      applyMiniMode(next.miniMode)
    }
    popup.webContents.send(IPC.settingsChanged, next)
    return next
  })

  ipcMain.handle(IPC.windowHide, (event) => {
    assertTrustedSender(event, popup)
    popup.hide()
  })

  ipcMain.handle(IPC.updateGetStatus, (event) => {
    assertTrustedSender(event, popup)
    return updater.getStatus()
  })

  // Always broadcast the whole status rather than diffing on `available`:
  // `latestVersion` and `url` can change while `available` stays true (a newer
  // release arriving on top of a known one), and a diff would leave the
  // renderer holding a stale version.
  const broadcastUpdateStatus = (): void => {
    if (!popup.isDestroyed()) {
      popup.webContents.send(IPC.updateChanged, updater.getStatus())
    }
  }

  // Manual checks always bypass the throttle.
  ipcMain.handle(IPC.updateCheck, async (event) => {
    assertTrustedSender(event, popup)
    const result = await updater.check({ force: true })
    broadcastUpdateStatus()
    return result
  })

  ipcMain.handle(IPC.updateSetAutoCheck, (event, enabled: unknown) => {
    assertTrustedSender(event, popup)
    const status = updater.setAutoCheck(enabled === true)
    broadcastUpdateStatus()
    return status
  })

  ipcMain.handle(IPC.updateSkip, (event, version: unknown) => {
    assertTrustedSender(event, popup)
    if (typeof version !== 'string' || version.length > 64 || !isComparableVersion(version)) {
      return updater.getStatus()
    }
    const status = updater.skipVersion(version)
    broadcastUpdateStatus()
    return status
  })

  // The argument crosses from the renderer and the URL itself originates from a
  // GitHub API response, so neither is trusted: this opens github.com over https
  // only, and never doubles as a general "open any site" gate.
  ipcMain.handle(IPC.shellOpenExternal, (event, url: unknown) => {
    assertTrustedSender(event, popup)
    if (!isAllowedExternalReleaseUrl(url)) return
    void shell.openExternal(url)
  })

  ipcMain.handle(IPC.aboutInfo, (event): AboutInfo => {
    assertTrustedSender(event, popup)
    return {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? ''
    }
  })

  // About links open only URLs from the fixed allow-list compiled into the
  // app, so this can never become a general "open any site" gate.
  ipcMain.handle(IPC.aboutOpenUrl, (event, url: unknown) => {
    assertTrustedSender(event, popup)
    if (typeof url !== 'string' || !ABOUT_URLS.has(url)) return
    void shell.openExternal(url)
  })

  engine.on('update', () => {
    // Electron may destroy the BrowserWindow while the app is quitting. Keep
    // this guard before isVisible(), which throws for a destroyed native object.
    if (!popup.isDestroyed() && popup.isVisible()) {
      popup.webContents.send(IPC.timerSnapshot, engine.snapshot())
    }
  })

  clockTimer.on('update', () => {
    // Same guard as the pomodoro push: the window may be destroyed mid-quit,
    // and a hidden window re-syncs on 'show' instead.
    if (!popup.isDestroyed() && popup.isVisible()) {
      popup.webContents.send(IPC.clockTimerSnapshot, clockTimer.snapshot())
    }
  })

  // Re-sync immediately when the popup becomes visible again.
  popup.on('show', () => {
    popup.webContents.send(IPC.timerSnapshot, engine.snapshot())
    popup.webContents.send(IPC.clockTimerSnapshot, clockTimer.snapshot())
  })
}
