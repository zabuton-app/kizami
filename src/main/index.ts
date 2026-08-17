import { app } from 'electron'
import { IPC } from '../shared/types'
import { ClockTimerEngine } from './clock-timer-engine'
import { registerIpc } from './ipc'
import { notifyClockTimerDone, notifyTransition } from './notifications'
import {
  applyMiniMode,
  createPopupWindow,
  installAppProtocol,
  markQuitting,
  showPopupNear,
  togglePopup
} from './popup-window'
import { SettingsStore } from './settings-store'
import { TimerEngine } from './timer-engine'
import { AppTray } from './tray'
import { UpdateStore } from './update-store'
import { Updater } from './updater'

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showPopupNear()
  })

  // Keep the app resident in the tray even when every window is closed.
  app.on('window-all-closed', () => {})
  app.on('before-quit', markQuitting)

  app.whenReady().then(() => {
    // Tray-only app: no dock icon on macOS.
    if (process.platform === 'darwin') {
      app.dock?.hide()
    }

    const settingsStore = new SettingsStore()
    const engine = new TimerEngine(() => settingsStore.get())
    const clockTimer = new ClockTimerEngine()
    const updater = new Updater(new UpdateStore())
    installAppProtocol()
    const popup = createPopupWindow()
    // Restore the persisted mini mode before the window is first shown.
    applyMiniMode(settingsStore.get().miniMode)

    const tray = new AppTray(
      {
        onToggle: (bounds) => togglePopup(bounds),
        onOpen: () => showPopupNear(),
        onQuit: () => {
          markQuitting()
          app.quit()
        }
      },
      settingsStore.get().trayIcon
    )

    const refreshTray = (): void =>
      tray.update(engine.isRunning(), engine.currentPhase(), settingsStore.get())

    // Stop the 1s tick before Electron starts destroying the popup and tray.
    // `unref()` only lets the process exit; it does not cancel the interval.
    // This wiring owns the app lifecycle and has no unit test; the guards it
    // backs up are covered by tests/unit/shutdown-guards.test.ts.
    app.once('before-quit', () => {
      engine.stop()
      clockTimer.stop()
    })

    registerIpc(engine, clockTimer, settingsStore, updater, popup)

    // Startup update check. Deliberately not awaited: a slow or unreachable
    // network must never delay startup, and any failure stays contained here so
    // the timer keeps working offline.
    if (updater.isAutoCheckEnabled()) {
      void updater
        .check()
        .then(() => {
          // Broadcast unconditionally: the renderer may have mounted before this
          // finished, in which case its initial getUpdateStatus() saw the
          // pre-check state and this is the only correction it will get.
          if (!popup.isDestroyed()) {
            popup.webContents.send(IPC.updateChanged, updater.getStatus())
          }
        })
        .catch((error) => console.warn('startup update check failed:', error))
    }

    engine.on('update', refreshTray)
    engine.on('transition', (transition) => notifyTransition(transition, settingsStore.get()))
    clockTimer.on('completed', () => notifyClockTimerDone(settingsStore.get()))

    refreshTray()
    engine.start()

    // Show the popup on launch; the app stays tray-resident either way.
    popup.once('ready-to-show', () => {
      showPopupNear()
    })

    // Dev-only seam for the documentation capture scripts (tools/demo-capture).
    // Everything else they need is reachable by clicking the UI; the timer is
    // not, because it lives here in the main process. Playwright can only reach
    // main-process globals, hence the assignment. Never defined in a packaged
    // build, so a release has no such entry point.
    if (app.isPackaged === false) {
      Object.defineProperty(globalThis, '__kizamiSimulateElapsed', {
        value: (ms: number) => engine.simulateElapsed(ms)
      })
    }
  })
}
