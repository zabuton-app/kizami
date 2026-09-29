/**
 * Pixel-level drawing for the tray countdown ring shown on Linux and Windows,
 * where a tray cannot carry a text title. Kept free of Electron imports so the
 * geometry and blending can be unit tested; tray.ts feeds it the raw bitmaps
 * from `nativeImage.toBitmap()` and turns the result back into an image.
 *
 * Bitmaps are Skia's N32 layout on those platforms: 4 bytes per pixel in
 * B, G, R, A order with premultiplied alpha.
 */

export interface RingColor {
  r: number
  g: number
  b: number
  /** Opacity, 0–1. */
  a: number
}

export interface RingStyle {
  /** Arc covering the elapsed part of the phase. */
  progress: RingColor
  /** Faint full circle behind the arc, so the remaining part reads too. */
  track: RingColor
}

/**
 * Width of the ring in pixels, and the gap between it and the icon. The gap is
 * measured along the axes: a square icon's corners reach past the ring's inner
 * edge, so the kizami icon's rounded corners sit slightly under the ring (the
 * round tomato clears it). This is accepted: shrinking the icon until its
 * corners clear too would leave the 刻 glyph unreadably small.
 */
const RING_WIDTH = 2
const RING_GAP = 1

/** Subsamples per pixel axis used to anti-alias the ring's edges. */
const SUPERSAMPLE = 4

/** Size of the icon drawn inside a ring on a canvas of `size` pixels. */
export function innerIconSize(size: number): number {
  return size - 2 * (RING_WIDTH + RING_GAP)
}

/**
 * Coverage of each part of the ring at pixel (x, y): how much of the pixel lies
 * on the ring, split into the elapsed arc and the rest. The arc starts at 12
 * o'clock and grows clockwise with `progress` (0 = nothing elapsed, 1 = done).
 */
export function ringCoverage(
  x: number,
  y: number,
  size: number,
  progress: number
): { arc: number; track: number } {
  const center = size / 2
  const outer = size / 2
  const inner = outer - RING_WIDTH
  const sweep = Math.min(1, Math.max(0, progress)) * 2 * Math.PI
  let arc = 0
  let track = 0
  for (let sy = 0; sy < SUPERSAMPLE; sy++) {
    for (let sx = 0; sx < SUPERSAMPLE; sx++) {
      const dx = x + (sx + 0.5) / SUPERSAMPLE - center
      const dy = y + (sy + 0.5) / SUPERSAMPLE - center
      const distance = Math.hypot(dx, dy)
      if (distance < inner || distance > outer) continue
      // Angle measured clockwise from 12 o'clock, in [0, 2π).
      const angle = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI)
      if (angle < sweep) arc++
      else track++
    }
  }
  const samples = SUPERSAMPLE * SUPERSAMPLE
  return { arc: arc / samples, track: track / samples }
}

/** Source-over one straight-alpha color onto a premultiplied BGRA pixel. */
function blend(canvas: Buffer, offset: number, color: RingColor, coverage: number): void {
  const alpha = color.a * coverage
  if (alpha <= 0) return
  const keep = 1 - alpha
  canvas[offset] = Math.round(color.b * alpha + canvas[offset] * keep)
  canvas[offset + 1] = Math.round(color.g * alpha + canvas[offset + 1] * keep)
  canvas[offset + 2] = Math.round(color.r * alpha + canvas[offset + 2] * keep)
  canvas[offset + 3] = Math.round(255 * alpha + canvas[offset + 3] * keep)
}

/**
 * Compose the tray image: `icon` (a square bitmap of `innerIconSize(size)`
 * pixels) centered on a transparent `size` × `size` canvas, with the countdown
 * ring around it.
 */
export function drawRingedIcon(
  icon: Buffer,
  size: number,
  progress: number,
  style: RingStyle
): Buffer {
  const iconSize = innerIconSize(size)
  if (icon.length !== iconSize * iconSize * 4) {
    throw new Error(`icon bitmap must be ${iconSize}x${iconSize}`)
  }
  const canvas = Buffer.alloc(size * size * 4)
  const inset = RING_WIDTH + RING_GAP
  for (let row = 0; row < iconSize; row++) {
    icon.copy(
      canvas,
      ((row + inset) * size + inset) * 4,
      row * iconSize * 4,
      (row + 1) * iconSize * 4
    )
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { arc, track } = ringCoverage(x, y, size, progress)
      const offset = (y * size + x) * 4
      blend(canvas, offset, style.track, track)
      blend(canvas, offset, style.progress, arc)
    }
  }
  return canvas
}
