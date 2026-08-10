import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { registerIpc } from '../../src/main/ipc'
import type { SettingsStore } from '../../src/main/settings-store'
import { TimerEngine } from '../../src/main/timer-engine'
import { AppTray } from '../../src/main/tray'
import type { Updater } from '../../src/main/updater'
import { DEFAULT_SETTINGS, IPC } from '../../src/shared/types'

/**
 * Shutdown ordering is not under the app's control: Electron may destroy the
 * popup window and the tray before the last timer tick is delivered. These
 * tests pin the guards that keep such a tick from touching a destroyed native
 * object, by faking the Electron behaviour that made the app throw — a method
 * call on a destroyed object.
 */

const tray = vi.hoisted(() => ({
  destroyed: false,
  setImage: vi.fn(),
  setToolTip: vi.fn(),
  setContextMenu: vi.fn(),
  on: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    isReady: () => true,
    getVersion: () => '0.0.0-test',
    getLocale: () => 'en-US'
  },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  session: {
    defaultSession: {
      setPermissionCheckHandler: vi.fn(),
      setPermissionRequestHandler: vi.fn()
    }
  },
  net: { fetch: vi.fn() },
  screen: { getDisplayNearestPoint: vi.fn(), getCursorScreenPoint: vi.fn() },
  BrowserWindow: class {},
  Menu: { buildFromTemplate: vi.fn(() => ({})) },
  Tray: class {
    isDestroyed = (): boolean => tray.destroyed
    setImage = tray.setImage
    setToolTip = tray.setToolTip
    setContextMenu = tray.setContextMenu
    on = tray.on
  },
  nativeImage: { createFromPath: vi.fn(() => ({ setTemplateImage: vi.fn() })) }
}))

/**
 * Stand-in for the popup window. `isVisible` throws exactly like Electron does
 * for a destroyed BrowserWindow, so dropping the `isDestroyed()` guard in
 * ipc.ts makes these tests fail instead of silently passing.
 */
function createFakePopup(
  destroyed: boolean,
  visible = true
): { popup: BrowserWindow; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  const popup = Object.assign(new EventEmitter(), {
    isDestroyed: () => destroyed,
    isVisible: () => {
      if (destroyed) throw new Error('Object has been destroyed')
      return visible
    },
    webContents: { send }
  })
  return { popup: popup as unknown as BrowserWindow, send }
}

function startEngineWith(popup: BrowserWindow): TimerEngine {
  const engine = new TimerEngine(() => ({ ...DEFAULT_SETTINGS }))
  registerIpc(engine, {} as SettingsStore, {} as Updater, popup)
  engine.start()
  return engine
}

beforeEach(() => {
  vi.clearAllMocks()
  tray.destroyed = false
})

afterEach(() => {
  vi.useRealTimers()
})

describe('timer updates during shutdown', () => {
  it('does not touch the popup once it has been destroyed', () => {
    vi.useFakeTimers()
    const { popup, send } = createFakePopup(true)
    const engine = startEngineWith(popup)

    expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
    expect(send).not.toHaveBeenCalled()

    engine.stop()
  })

  it('still pushes a snapshot to a live, visible popup', () => {
    vi.useFakeTimers()
    const { popup, send } = createFakePopup(false)
    const engine = startEngineWith(popup)

    vi.advanceTimersByTime(1000)
    expect(send).toHaveBeenCalledWith(IPC.timerSnapshot, expect.anything())

    engine.stop()
  })

  it('does not touch the tray once it has been destroyed', () => {
    const appTray = new AppTray({ onToggle: vi.fn(), onOpen: vi.fn(), onQuit: vi.fn() })
    tray.destroyed = true

    expect(() => appTray.update(true, 'work', DEFAULT_SETTINGS)).not.toThrow()
    expect(tray.setToolTip).not.toHaveBeenCalled()
    expect(tray.setContextMenu).not.toHaveBeenCalled()
  })

  it('still refreshes a live tray', () => {
    const appTray = new AppTray({ onToggle: vi.fn(), onOpen: vi.fn(), onQuit: vi.fn() })

    appTray.update(true, 'work', DEFAULT_SETTINGS)
    expect(tray.setToolTip).toHaveBeenCalledTimes(1)
    expect(tray.setContextMenu).toHaveBeenCalledTimes(1)
  })
})
