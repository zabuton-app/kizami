import { Menu, Tray, app, nativeImage } from 'electron'
import { t } from '../shared/i18n'
import { DEFAULT_TRAY_ICON, type Phase, type Settings, type TrayIconId } from '../shared/types'
import trayIdle from '../../resources/tray-idle.png?asset'
import trayRunning from '../../resources/tray-running.png?asset'
import trayTemplate from '../../resources/trayTemplate.png?asset'
import trayIdleTomato from '../../resources/tray-idle-tomato.png?asset'
import trayRunningTomato from '../../resources/tray-running-tomato.png?asset'
import trayTemplateTomato from '../../resources/trayTemplate-tomato.png?asset'

export interface TrayCallbacks {
  onToggle: (bounds?: Electron.Rectangle) => void
  onOpen: () => void
  onQuit: () => void
}

const PHASE_KEY = {
  work: 'phase.work',
  shortBreak: 'phase.shortBreak',
  longBreak: 'phase.longBreak'
} as const

const TRAY_IMAGES: Record<TrayIconId, { idle: string; running: string; template: string }> = {
  kizami: { idle: trayIdle, running: trayRunning, template: trayTemplate },
  tomato: { idle: trayIdleTomato, running: trayRunningTomato, template: trayTemplateTomato }
}

/**
 * Tray icon with two visual states (idle / running) and a user-selectable
 * icon set (settings.trayIcon).
 * On macOS a template image is used so the menu bar adapts to light/dark.
 */
export class AppTray {
  private readonly tray: Tray
  private running = false
  private icon: TrayIconId

  constructor(
    private readonly callbacks: TrayCallbacks,
    icon: TrayIconId = DEFAULT_TRAY_ICON
  ) {
    this.icon = icon
    this.tray = new Tray(this.imageFor(false))
    this.tray.on('click', (_event, bounds) => this.callbacks.onToggle(bounds))
  }

  private imageFor(running: boolean): Electron.NativeImage {
    const images = TRAY_IMAGES[this.icon]
    if (process.platform === 'darwin') {
      const image = nativeImage.createFromPath(images.template)
      image.setTemplateImage(true)
      return image
    }
    return nativeImage.createFromPath(running ? images.running : images.idle)
  }

  /** Refresh icon state, tooltip and context menu (language may have changed). */
  update(running: boolean, phase: Phase, settings: Settings): void {
    // A final timer update can race with native object teardown on shutdown.
    if (this.tray.isDestroyed()) return

    const iconChanged = settings.trayIcon !== this.icon
    // macOS shows one template image regardless of running state, so only an
    // icon-set change needs a new image there.
    const stateChanged = running !== this.running && process.platform !== 'darwin'
    this.icon = settings.trayIcon
    this.running = running
    if (iconChanged || stateChanged) {
      this.tray.setImage(this.imageFor(running))
    }
    this.tray.setToolTip(`刻 — ${t(settings.language, PHASE_KEY[phase])}`)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: t(settings.language, 'tray.open'), click: () => this.callbacks.onOpen() },
        { type: 'separator' },
        { label: t(settings.language, 'tray.quit'), click: () => this.callbacks.onQuit() }
      ])
    )
  }

  destroy(): void {
    this.tray.destroy()
  }
}

export function isTraySupported(): boolean {
  // Tray is created after app ready; this is a hook for future platform checks.
  return app.isReady()
}
