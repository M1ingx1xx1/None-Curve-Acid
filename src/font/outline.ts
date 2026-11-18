// A glyph's outline as polygons (font units, y up): fontkit's path commands with every curve cut into straight sides.
// The morph pairs anchors of these polygons (morph/pair.ts), so curves are flattened once per glyph, not per frame.

import type { Glyph } from 'fontkit'
import type { Point, PolygonContour, PolygonGlyph } from '../morph/types'

export interface PathCommand {
  command: string
  args: number[]
}

/** Sides per curve at least and at most. */
export const OUTLINE_LIMITS = { minSides: 2, maxSides: 64 } as const

/**
 * Sides that keep a curve within `tolerance` (font units) of its polygon: Wang's formula, `weight` d(d−1)/8 for degree
 * d (0.25 quadratic, 0.75 cubic), `bend` the largest second difference of its control points.
 */
function sidesFor(bend: number, weight: number, tolerance: number): number {
  const n = Math.ceil(Math.sqrt((weight * bend) / Math.max(1e-9, tolerance)))
  return Math.max(OUTLINE_LIMITS.minSides, Math.min(OUTLINE_LIMITS.maxSides, n))
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

/**
 * Path commands (moveTo, lineTo, quadraticCurveTo, bezierCurveTo, closePath) as closed polygons, every curve within
 * `tolerance` (font units) of the true outline.
 */
export function flattenCommands(commands: readonly PathCommand[], tolerance: number): PolygonGlyph {
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
      const n = sidesFor(Math.hypot(x0 - 2 * cx + ex, y0 - 2 * cy + ey), 0.25, tolerance)
      for (let i = 1; i <= n; i++) {
        const t = i / n
        const u = 1 - t
        push(u * u * x0 + 2 * u * t * cx + t * t * ex, u * u * y0 + 2 * u * t * cy + t * t * ey)
      }
    } else if (command === 'bezierCurveTo') {
      const [c1x, c1y, c2x, c2y, ex, ey] = args
      const x0 = x
      const y0 = y
      const bend = Math.max(
        Math.hypot(x0 - 2 * c1x + c2x, y0 - 2 * c1y + c2y),
        Math.hypot(c1x - 2 * c2x + ex, c1y - 2 * c2y + ey),
      )
      const n = sidesFor(bend, 0.75, tolerance)
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

/** `glyph` as polygons within `tolerance` font units of its curves. */
export function glyphPolygon(glyph: Glyph, tolerance: number): PolygonGlyph {
  return flattenCommands(glyph.path.commands as PathCommand[], tolerance)
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

/**
 * `glyph` with anchors added on every side longer than `maxSide` (font units), evenly along it. The anchors it had stay
 * where they are, so corners and spikes keep their shape; 0 or less adds none.
 */
export function densify(glyph: PolygonGlyph, maxSide: number): PolygonGlyph {
  if (!(maxSide > 0)) return glyph
  return {
    contours: glyph.contours.map((c) => {
      const points: Point[] = []
      const n = c.points.length
      for (let i = 0; i < n; i++) {
        const p = c.points[i]
        const q = c.points[(i + 1) % n]
        points.push(p)
        const parts = Math.min(256, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / maxSide))
        for (let k = 1; k < parts; k++)
          points.push({ x: p.x + ((q.x - p.x) * k) / parts, y: p.y + ((q.y - p.y) * k) / parts })
      }
      return { clockwise: c.clockwise, points }
    }),
  }
}
