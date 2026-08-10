import { app, BrowserWindow, net, protocol, screen, session, type Rectangle } from 'electron'
import { pathToFileURL } from 'node:url'
import { join, resolve, sep } from 'node:path'
import {
  WINDOW_MIN_CONTENT_HEIGHT,
  WINDOW_MIN_SCALE,
  WINDOW_MINI_SIZE,
  WINDOW_SIZE
} from '../shared/types'
import {
  NUDGE_RESTORE_MS,
  PopupTransitionState,
  TRANSITION_SETTLE_MS
} from './popup-transition-state'

const TRAY_MARGIN = 8
export const APP_RENDERER_ORIGIN = 'app://bundle'
const APP_RENDERER_ROOT = resolve(import.meta.dirname, '../renderer')

// Register before app ready so Chromium assigns normal, secure web-origin
// semantics to the bundled renderer instead of file://'s extra privileges.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

const ZOOM_MIN = 0.6
const ZOOM_MAX = 1.5
const ZOOM_STEP = 0.1

let win: BrowserWindow | null = null
let quitting = false
let miniMode = false
const transitionState = new PopupTransitionState()

/**
 * Size the user last gave the window while it was visible. Re-applied on every
 * show, because on Wayland mapping the surface resizes the window (Hyprland
 * opens it at the max size hint). Initialized to the creation size so the very
 * first map is corrected too.
 */
let lastSize: { width: number; height: number } = { ...WINDOW_SIZE }

/** Allow the window to actually close when the app is quitting from the tray menu. */
export function markQuitting(): void {
  quitting = true
}

export function getPopupWindow(): BrowserWindow | null {
  return win
}

/** Serve only files inside the bundled renderer directory over app://bundle/. */
export function installAppProtocol(): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url)
    if (url.host !== 'bundle') {
      return new Response('Not found', { status: 404 })
    }

    let relativePath: string
    try {
      relativePath = decodeURIComponent(
        url.pathname === '/' ? '/index.html' : url.pathname
      ).replace(/^\/+/, '')
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    const target = resolve(APP_RENDERER_ROOT, relativePath)
    if (!target.startsWith(`${APP_RENDERER_ROOT}${sep}`)) {
      return new Response('Not found', { status: 404 })
    }
    return net.fetch(pathToFileURL(target).toString())
  })

  // The renderer does not need camera, geolocation, notifications, MIDI, etc.
  // Desktop notifications are created by the main process.
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
}

export function createPopupWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: WINDOW_SIZE.width,
    height: WINDOW_SIZE.height,
    minWidth: Math.round(WINDOW_SIZE.width * WINDOW_MIN_SCALE),
    minHeight: WINDOW_MIN_CONTENT_HEIGHT,
    maxWidth: Math.round(WINDOW_SIZE.width * ZOOM_MAX),
    maxHeight: Math.round(WINDOW_SIZE.height * ZOOM_MAX),
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: app.isPackaged === false
    }
  })

  // The app has no renderer-driven popup flow. Release links use the validated
  // IPC method instead, so all window creation can be denied unconditionally.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Neither the production UI nor the development UI needs top-level
  // navigation. Initial loadURL calls do not pass through this event.
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  // Resizing the window never rescales the UI; the layout is fluid and the
  // flexible slack above the theme picker absorbs height changes. The UI
  // scale is controlled explicitly with Ctrl+scroll instead.
  win.webContents.on('zoom-changed', (_event, direction) => {
    if (!win) return
    // A zoom right after show may resize the window (min-size enforcement);
    // that resize is intentional, so stop treating events as remap noise.
    transitionState.clearRemap()
    const current = win.webContents.getZoomFactor()
    const step = direction === 'in' ? ZOOM_STEP : -ZOOM_STEP
    const next = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + step)) * 10) / 10
    win.webContents.setZoomFactor(next)
    if (miniMode) {
      // The mini window stays fixed-size; track the zoom with the size itself.
      applyMiniConstraints(next)
      return
    }
    // A mini-exit transition may still be holding the max at the restore
    // target (see applyMiniMode); widen it first so the new floor can never
    // exceed it.
    win.setMaximumSize(
      Math.round(WINDOW_SIZE.width * ZOOM_MAX),
      Math.round(WINDOW_SIZE.height * ZOOM_MAX)
    )
    // Keep the height floor in sync so a zoomed-out UI can shrink further.
    win.setMinimumSize(
      Math.round(WINDOW_SIZE.width * WINDOW_MIN_SCALE),
      Math.round(WINDOW_MIN_CONTENT_HEIGHT * next)
    )
  })

  win.on('resize', () => {
    if (!win?.isVisible()) return
    const now = Date.now()
    // The viewport-sync nudge resizes on purpose; do not fight or record it.
    if (transitionState.isNudging(now)) return
    const [width, height] = win.getSize()
    if (transitionState.consumeRemap(now)) {
      const want = miniMode ? miniSize(win.webContents.getZoomFactor()) : lastSize
      if (width !== want.width || height !== want.height) {
        win.setSize(want.width, want.height)
        return
      }
    }
    if (miniMode) {
      // The mini window is fixed-size; snap back any stray compositor resize
      // (Wayland applies size-hint enforcement asynchronously) and never let
      // its size into lastSize, which must keep recording the size to
      // restore on exit.
      const want = miniSize(win.webContents.getZoomFactor())
      if (width !== want.width || height !== want.height) {
        win.setSize(want.width, want.height)
      }
      return
    }
    if (transitionState.isTransitioning(now)) {
      if (width !== lastSize.width || height !== lastSize.height) {
        win.setSize(lastSize.width, lastSize.height)
        return
      }
      // Matching events fall through on purpose: the settle window stays
      // armed until the deadline, because stale-hint enforcement can arrive
      // AFTER the intentional resize already reported the correct size.
    }
    lastSize = { width, height }
  })

  // The close button and OS shortcuts hide the popup; the app stays resident.
  win.on('close', (event) => {
    if (!quitting && win) {
      event.preventDefault()
      win.hide()
    }
  })

  const developmentUrl = app.isPackaged === false ? process.env.ELECTRON_RENDERER_URL : undefined
  if (developmentUrl) {
    void win.loadURL(developmentUrl)
  } else {
    void win.loadURL(`${APP_RENDERER_ORIGIN}/index.html`)
  }

  return win
}

/** Mini window size at the given zoom factor. */
function miniSize(zoom: number): { width: number; height: number } {
  return {
    width: Math.round(WINDOW_MINI_SIZE.width * zoom),
    height: Math.round(WINDOW_MINI_SIZE.height * zoom)
  }
}

/** Pin the window to the fixed mini size (min = max) for the given zoom. */
function applyMiniConstraints(zoom: number): void {
  if (!win) return
  const size = miniSize(zoom)
  // The current min may exceed the target on some axis (the normal-mode
  // height floor, or a high-zoom mini width); lower those axes first so no
  // later max update can dip under the min.
  const [currentMinWidth, currentMinHeight] = win.getMinimumSize()
  win.setMinimumSize(Math.min(currentMinWidth, size.width), Math.min(currentMinHeight, size.height))
  // Keep min ≤ max at every step: when growing (zoom-in) widen the max
  // first, when shrinking tighten the min first. Any async hint-enforcement
  // resize lands exactly on the target (min = max = size), so it is benign.
  const [currentMaxWidth, currentMaxHeight] = win.getMaximumSize()
  if (size.width > currentMaxWidth || size.height > currentMaxHeight) {
    win.setMaximumSize(size.width, size.height)
    win.setMinimumSize(size.width, size.height)
  } else {
    win.setMinimumSize(size.width, size.height)
    win.setMaximumSize(size.width, size.height)
  }
  win.setSize(size.width, size.height)
}

/**
 * After a transition settles, verify that the renderer's CSS viewport matches
 * the window's actual content size. Wayland applies our resizes
 * asynchronously, and when several land in quick succession the renderer can
 * be left holding a stale, larger viewport — the page stays laid out for the
 * old size and paints clipped at the window edge until some manual resize
 * forces a fresh configure event. Detect that mismatch and force the fresh
 * event ourselves with a 1px resize nudge.
 */
function syncViewportAfterTransition(seq: number): void {
  const target = win
  if (!target) return
  // Runs after the transition's second settle window (the max-size restore
  // in applyMiniMode re-arms one), so the sizes it compares are final.
  setTimeout(
    () => {
      if (!transitionState.isCurrent(seq)) return
      if (win !== target || win.isDestroyed() || !win.isVisible()) return
      void win.webContents
        .executeJavaScript('[window.innerWidth, window.innerHeight]')
        .then(([viewportWidth, viewportHeight]: [number, number]) => {
          if (!transitionState.isCurrent(seq)) return
          if (win !== target || win.isDestroyed() || !win.isVisible()) return
          const zoom = win.webContents.getZoomFactor()
          const [contentWidth, contentHeight] = win.getContentSize()
          const staleBy = Math.max(
            Math.abs(viewportWidth - contentWidth / zoom),
            Math.abs(viewportHeight - contentHeight / zoom)
          )
          // Rounding between DIP and CSS px accounts for ~1px; anything larger
          // means the renderer missed the final resize.
          if (staleBy <= 2) return
          // Hold the resize handler off while the window is 1px astray, then
          // restore in a later task — restoring in the same task would let the
          // compositor coalesce the pair into a no-op, delivering no fresh
          // configure event at all.
          transitionState.beginNudge(Date.now())
          if (miniMode) {
            // min = max pins the mini size, so a plain setSize would be clamped
            // into a no-op. Loosen the floor for the nudge, then let
            // applyMiniConstraints pin everything back.
            const size = miniSize(zoom)
            win.setMinimumSize(size.width, size.height - 1)
            win.setSize(size.width, size.height - 1)
          } else {
            const [width, height] = win.getSize()
            const [, maxHeight] = win.getMaximumSize()
            // Nudge into whichever direction has headroom, so the constraint
            // clamp can never swallow the resize.
            win.setSize(width, height + 1 <= maxHeight ? height + 1 : height - 1)
          }
          setTimeout(() => {
            if (!transitionState.isCurrent(seq)) return
            if (win !== target || win.isDestroyed()) return
            if (miniMode) {
              applyMiniConstraints(win.webContents.getZoomFactor())
            } else {
              win.setSize(lastSize.width, lastSize.height)
            }
            transitionState.finishNudge()
          }, NUDGE_RESTORE_MS)
        })
        .catch(() => {
          // The renderer may be mid-reload; the next transition retries.
        })
    },
    TRANSITION_SETTLE_MS * 2 + 100
  )
}

/**
 * Switch the window between the fixed-size mini layout and the resizable
 * normal layout. The last user-given normal size survives a round trip.
 */
export function applyMiniMode(mini: boolean): void {
  miniMode = mini
  if (!win) return
  // The mode switch invalidates older callbacks, clears remap/nudge guards,
  // and arms stale-hint correction around the transition.
  const seq = transitionState.beginTransition(Date.now())
  const zoom = win.webContents.getZoomFactor()
  if (mini) {
    applyMiniConstraints(zoom)
    syncViewportAfterTransition(seq)
    return
  }
  const minWidth = Math.round(WINDOW_SIZE.width * WINDOW_MIN_SCALE)
  const minHeight = Math.round(WINDOW_MIN_CONTENT_HEIGHT * zoom)
  const maxWidth = Math.round(WINDOW_SIZE.width * ZOOM_MAX)
  const maxHeight = Math.round(WINDOW_SIZE.height * ZOOM_MAX)
  // The zoom may have changed while mini mode was active (its handler skips
  // the normal-mode floor update), so re-clamp the recorded size before use —
  // otherwise the OS clamps silently and the clamped value would drift
  // lastSize on every round trip.
  lastSize = {
    width: Math.min(maxWidth, Math.max(minWidth, lastSize.width)),
    height: Math.min(maxHeight, Math.max(minHeight, lastSize.height))
  }
  // Order matters on Wayland, where size-hint enforcement resizes arrive
  // asynchronously and can land AFTER a subsequent setSize: loosen the min
  // first (the mini min tracks zoom and can exceed the restore target, and
  // min ≤ max must hold at every step), cap the max at the restore target,
  // resize, then tighten the min — lastSize already satisfies it, so that
  // fires no enforcement.
  //
  // The max is capped at the restore target instead of the real bounds
  // because some compositors apply a max-size hint as an actual resize
  // (Hyprland does on map, see lastSize's doc comment), and a transient
  // oversized window makes the renderer lay the page out wider than the
  // final size — which paints clipped if the snap-back resize gets lost.
  // The real bounds follow once the transition has settled.
  const [currentMinWidth, currentMinHeight] = win.getMinimumSize()
  win.setMinimumSize(Math.min(currentMinWidth, minWidth), Math.min(currentMinHeight, minHeight))
  win.setMaximumSize(lastSize.width, lastSize.height)
  win.setSize(lastSize.width, lastSize.height)
  win.setMinimumSize(minWidth, minHeight)
  setTimeout(() => {
    if (!transitionState.isCurrent(seq) || !win || win.isDestroyed() || miniMode) return
    // If the compositor treats the widened max hint as a resize, the resize
    // handler must still be in its settle window to snap it back.
    transitionState.rearmTransition(Date.now())
    win.setMaximumSize(maxWidth, maxHeight)
  }, TRANSITION_SETTLE_MS)
  syncViewportAfterTransition(seq)
  // The mini window may have been dragged near a screen edge; growing back
  // from there can push the normal window off-screen, so re-clamp the origin.
  const [x, y] = win.getPosition()
  const workArea = screen.getDisplayNearestPoint({ x, y }).workArea
  win.setPosition(
    Math.min(
      Math.max(x, workArea.x + TRAY_MARGIN),
      workArea.x + workArea.width - lastSize.width - TRAY_MARGIN
    ),
    Math.min(
      Math.max(y, workArea.y + TRAY_MARGIN),
      workArea.y + workArea.height - lastSize.height - TRAY_MARGIN
    )
  )
}

/**
 * Show the popup near the tray icon. Falls back to the cursor position when
 * tray bounds are unavailable (common on Linux status areas).
 */
export function showPopupNear(trayBounds?: Rectangle): void {
  if (!win) return

  const size = miniMode ? miniSize(win.webContents.getZoomFactor()) : lastSize
  win.setSize(size.width, size.height)
  const { width, height } = size

  const anchor =
    trayBounds && trayBounds.width > 0
      ? {
          x: Math.round(trayBounds.x + trayBounds.width / 2),
          y: Math.round(trayBounds.y + trayBounds.height / 2)
        }
      : screen.getCursorScreenPoint()

  const workArea = screen.getDisplayNearestPoint(anchor).workArea

  let x = anchor.x - Math.round(width / 2)
  // Place below the anchor when the tray is at the top of the screen, above otherwise.
  const anchorInUpperHalf = anchor.y < workArea.y + workArea.height / 2
  let y = anchorInUpperHalf ? anchor.y + TRAY_MARGIN : anchor.y - height - TRAY_MARGIN

  x = Math.min(
    Math.max(x, workArea.x + TRAY_MARGIN),
    workArea.x + workArea.width - width - TRAY_MARGIN
  )
  y = Math.min(
    Math.max(y, workArea.y + TRAY_MARGIN),
    workArea.y + workArea.height - height - TRAY_MARGIN
  )

  win.setPosition(x, y)
  if (!win.isVisible()) transitionState.armRemap(Date.now())
  win.show()
  win.focus()
}

export function togglePopup(trayBounds?: Rectangle): void {
  if (!win) return
  if (win.isVisible()) {
    win.hide()
  } else {
    showPopupNear(trayBounds)
  }
}
