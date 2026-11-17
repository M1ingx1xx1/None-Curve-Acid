// A glyph's outline as polygons (font units, y up): fontkit's path commands with every curve cut into straight sides.
// The morph pairs anchors of these polygons (morph/pair.ts), so curves are flattened once per glyph, not per frame.

import type { Glyph } from 'fontkit'
import type { Point, PolygonContour, PolygonGlyph } from '../morph/types'

export interface PathCommand {
  command: string
  args: number[]
}

/** Sides per curve at most, and the length (a share of the em) one side covers at most. */
export const OUTLINE_LIMITS = { maxSides: 12, sideShare: 0.02 } as const

function sidesFor(length: number, unitsPerEm: number): number {
  return Math.max(2, Math.min(OUTLINE_LIMITS.maxSides, Math.ceil(length / (OUTLINE_LIMITS.sideShare * unitsPerEm))))
}

/** Signed area (y up: positive is counterclockwise). */
export function signedArea(points: Point[]): number {
  let twice = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const q = points[(i + 1) % points.length]
    twice += p.x * q.y - q.x * p.y
  }
  return twice / 2
}

/** Path commands (moveTo, lineTo, quadraticCurveTo, bezierCurveTo, closePath) as closed polygons. */
export function flattenCommands(commands: readonly PathCommand[], unitsPerEm: number): PolygonGlyph {
  const contours: PolygonContour[] = []
  let points: Point[] = []
  let x = 0
  let y = 0
  const close = () => {
    // The closing point repeats the first in many fonts.
    if (points.length > 1) {
      const a = points[0]
      const b = points[points.length - 1]
      if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) points.pop()
    }
    if (points.length >= 3) contours.push({ points, clockwise: signedArea(points) < 0 })
    points = []
  }
  const push = (px: number, py: number) => {
    const last = points[points.length - 1]
    if (!last || last.x !== px || last.y !== py) points.push({ x: px, y: py })
    x = px
    y = py
  }
  for (const { command, args } of commands) {
    if (command === 'moveTo') {
      close()
      push(args[0], args[1])
    } else if (command === 'lineTo') {
      push(args[0], args[1])
    } else if (command === 'quadraticCurveTo') {
      const [cx, cy, ex, ey] = args
      const x0 = x
      const y0 = y
      const n = sidesFor(Math.hypot(cx - x0, cy - y0) + Math.hypot(ex - cx, ey - cy), unitsPerEm)
      for (let i = 1; i <= n; i++) {
        const t = i / n
        const u = 1 - t
        push(u * u * x0 + 2 * u * t * cx + t * t * ex, u * u * y0 + 2 * u * t * cy + t * t * ey)
      }
    } else if (command === 'bezierCurveTo') {
      const [c1x, c1y, c2x, c2y, ex, ey] = args
      const x0 = x
      const y0 = y
      const n = sidesFor(
        Math.hypot(c1x - x0, c1y - y0) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(ex - c2x, ey - c2y),
        unitsPerEm,
      )
      for (let i = 1; i <= n; i++) {
        const t = i / n
        const u = 1 - t
        const a = u * u * u
        const b = 3 * u * u * t
        const c = 3 * u * t * t
        const d = t * t * t
        push(a * x0 + b * c1x + c * c2x + d * ex, a * y0 + b * c1y + c * c2y + d * ey)
      }
    } else if (command === 'closePath') {
      close()
    }
  }
  close()
  return { contours }
}

export function glyphPolygon(glyph: Glyph, unitsPerEm: number): PolygonGlyph {
  return flattenCommands(glyph.path.commands as PathCommand[], unitsPerEm)
}

/** `glyph` scaled by `scale` and moved by `dx` (font units): B placed in A's em. */
export function placePolygon(glyph: PolygonGlyph, scale: number, dx: number): PolygonGlyph {
  return {
    contours: glyph.contours.map((c) => ({
      clockwise: c.clockwise,
      points: c.points.map((p) => ({ x: p.x * scale + dx, y: p.y * scale })),
    })),
  }
}
