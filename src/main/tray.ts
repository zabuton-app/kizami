import { Menu, Tray, app, nativeImage } from 'electron'
import { t } from '../shared/i18n'
import {
  DEFAULT_TRAY_ICON,
  type Phase,
  type Settings,
  type TimerSnapshot,
  type TrayIconId
} from '../shared/types'
import { drawRingedIcon, innerIconSize, type RingStyle } from './tray-ring'
import { trayTime, type TrayTime } from './tray-time'
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

const TRACK = { r: 128, g: 128, b: 128, a: 0.45 }
/** The candy theme's primary (--primary in styles.css); the tray does not follow the theme. */
const WORK_ARC = { r: 255, g: 107, b: 87, a: 1 }
const BREAK_ARC = { r: 63, g: 191, b: 127, a: 1 }
const PAUSED_ARC = { r: 150, g: 150, b: 150, a: 1 }

const RING_STYLES: Record<Phase, RingStyle> = {
  work: { progress: WORK_ARC, track: TRACK },
  shortBreak: { progress: BREAK_ARC, track: TRACK },
  longBreak: { progress: BREAK_ARC, track: TRACK }
}
const PAUSED_RING_STYLE: RingStyle = { progress: PAUSED_ARC, track: TRACK }

/**
 * macOS can put text beside a tray icon; Linux and Windows trays cannot, so
 * there the time is drawn into the icon as a ring instead.
 */
const SHOWS_TITLE = process.platform === 'darwin'

/**
 * Tray icon with two visual states (idle / running) and a user-selectable
 * icon set (settings.trayIcon).
 * On macOS a template image is used so the menu bar adapts to light/dark.
 *
 * While a phase is under way the tray also shows its time (settings.trayTime):
 * as a text title beside the icon on macOS, and as a progress ring drawn around
 * the icon elsewhere.
 */
export class AppTray {
  private readonly tray: Tray
  private icon: TrayIconId
  /** Identifies the image currently set, so a tick that changes nothing skips setImage. */
  private imageKey: string
  private title = ''
  private toolTip = ''

  constructor(
    private readonly callbacks: TrayCallbacks,
    icon: TrayIconId = DEFAULT_TRAY_ICON
  ) {
    this.icon = icon
    const initial = this.imageSpec(false, 'work', null)
    this.imageKey = initial.key
    this.tray = new Tray(initial.build())
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

  /**
   * The icon with the time ring around it. The icon is shrunk to leave room
   * for the ring, so the canvas stays the size the tray expects.
   */
  private ringedImageFor(running: boolean, phase: Phase, time: TrayTime): Electron.NativeImage {
    const base = this.imageFor(running)
    const size = base.getSize().width
    const inner = innerIconSize(size)
    const icon = base.resize({ width: inner, height: inner, quality: 'best' }).toBitmap()
    const style = running ? RING_STYLES[phase] : PAUSED_RING_STYLE
    const bitmap = drawRingedIcon(icon, size, time.progress, style)
    return nativeImage.createFromBitmap(bitmap, { width: size, height: size })
  }

  /**
   * Which image the tray should show, as a key naming it and a way to build
   * it. Both come from one decision so the key can never describe a different
   * image from the one built.
   */
  private imageSpec(
    running: boolean,
    phase: Phase,
    time: TrayTime | null
  ): { key: string; build: () => Electron.NativeImage } {
    // macOS shows one template image regardless of running state, and its
    // time is a title, so only the icon set changes the image there.
    if (SHOWS_TITLE) return { key: this.icon, build: () => this.imageFor(running) }
    if (!time) return { key: `${this.icon}|${running}`, build: () => this.imageFor(running) }
    return {
      key: `${this.icon}|${running}|${phase}|${time.progress}`,
      build: () => {
        try {
          return this.ringedImageFor(running, phase, time)
        } catch (error) {
          // A tray without its ring is better than a timer tick that throws.
          console.warn('tray ring drawing failed:', error)
          return this.imageFor(running)
        }
      }
    }
  }

  /** Refresh icon state, time, tooltip and context menu (language may have changed). */
  update(snapshot: TimerSnapshot, settings: Settings): void {
    // A final timer update can race with native object teardown on shutdown.
    if (this.tray.isDestroyed()) return

    const { running, phase } = snapshot
    const time = trayTime(snapshot, settings)
    this.icon = settings.trayIcon
    const image = this.imageSpec(running, phase, time)
    if (image.key !== this.imageKey) {
      this.tray.setImage(image.build())
      this.imageKey = image.key
    }
    if (SHOWS_TITLE) {
      const title = time ? ` ${time.text}` : ''
      if (title !== this.title) {
        this.tray.setTitle(title, { fontType: 'monospacedDigit' })
        this.title = title
      }
    }
    const phaseLabel = t(settings.language, PHASE_KEY[phase])
    const detail = time
      ? ` ${time.text}${running ? '' : ` ${t(settings.language, 'tray.paused')}`}`
      : ''
    const toolTip = `刻 — ${phaseLabel}${detail}`
    if (toolTip !== this.toolTip) {
      this.tray.setToolTip(toolTip)
      this.toolTip = toolTip
    }
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
