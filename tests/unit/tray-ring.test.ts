import { describe, expect, it } from 'vitest'
import { drawRingedIcon, innerIconSize, ringCoverage } from '../../src/main/tray-ring'

const SIZE = 22
const STYLE = {
  progress: { r: 255, g: 0, b: 0, a: 1 },
  track: { r: 0, g: 0, b: 255, a: 0.5 }
}

function pixel(
  canvas: Buffer,
  x: number,
  y: number
): { b: number; g: number; r: number; a: number } {
  const offset = (y * SIZE + x) * 4
  return {
    b: canvas[offset],
    g: canvas[offset + 1],
    r: canvas[offset + 2],
    a: canvas[offset + 3]
  }
}

describe('ringCoverage', () => {
  it('leaves the center and the corners off the ring', () => {
    expect(ringCoverage(11, 11, SIZE, 0.5)).toEqual({ arc: 0, track: 0 })
    expect(ringCoverage(0, 0, SIZE, 0.5)).toEqual({ arc: 0, track: 0 })
  })

  it('puts the whole ring on the track before any time has passed', () => {
    const top = ringCoverage(10, 0, SIZE, 0)
    expect(top.arc).toBe(0)
    expect(top.track).toBeGreaterThan(0)
  })

  it('grows the arc clockwise from 12 o’clock', () => {
    // A quarter in: 3 o'clock is just past the arc's end, the upper right is on it.
    expect(ringCoverage(17, 2, SIZE, 0.25).arc).toBeGreaterThan(0)
    expect(ringCoverage(4, 2, SIZE, 0.25).arc).toBe(0)
    expect(ringCoverage(10, 20, SIZE, 0.25).arc).toBe(0)
    // Three quarters in: the bottom and the left are covered too.
    expect(ringCoverage(10, 20, SIZE, 0.75).arc).toBeGreaterThan(0)
    expect(ringCoverage(4, 2, SIZE, 0.75).arc).toBe(0)
  })

  it('covers the whole ring once the phase is done', () => {
    for (const [x, y] of [
      [10, 0],
      [21, 11],
      [10, 21],
      [0, 11]
    ]) {
      expect(ringCoverage(x, y, SIZE, 1).track).toBe(0)
    }
  })
})

describe('drawRingedIcon', () => {
  const iconSize = innerIconSize(SIZE)
  // An opaque white icon, premultiplied BGRA.
  const icon = Buffer.alloc(iconSize * iconSize * 4, 255)

  it('keeps the canvas the size of the tray icon', () => {
    expect(drawRingedIcon(icon, SIZE, 0.5, STYLE)).toHaveLength(SIZE * SIZE * 4)
  })

  it('centers the icon inside the ring', () => {
    const canvas = drawRingedIcon(icon, SIZE, 0.5, STYLE)
    expect(pixel(canvas, 11, 11)).toEqual({ b: 255, g: 255, r: 255, a: 255 })
    expect(pixel(canvas, 0, 0).a).toBe(0)
  })

  it('writes the arc color in BGRA order', () => {
    const canvas = drawRingedIcon(icon, SIZE, 1, STYLE)
    // Solidly on the ring at 3 o'clock.
    const onRing = pixel(canvas, 20, 11)
    expect(onRing.r).toBeGreaterThan(200)
    expect(onRing.b).toBe(0)
    expect(onRing.a).toBeGreaterThan(200)
  })

  it('draws the rest of the ring as the translucent track', () => {
    const canvas = drawRingedIcon(icon, SIZE, 0, STYLE)
    const onRing = pixel(canvas, 20, 11)
    expect(onRing.r).toBe(0)
    expect(onRing.b).toBeGreaterThan(0)
    expect(onRing.a).toBeLessThanOrEqual(128)
  })

  it('rejects an icon of the wrong size', () => {
    expect(() => drawRingedIcon(Buffer.alloc(4), SIZE, 0, STYLE)).toThrow()
  })
})
