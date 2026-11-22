// Glitch: the in-between shapes of A→B torn, shifted and stretched, and held longer. Only shapes on their way change:
// at t = 0 a letter is exactly A, at t = 1 exactly B, so the letters come back together as they finish. Everything
// moves with smooth noise in time (no per-frame random jumps), so the motion stays continuous. Pure.

import { valueNoise } from './brush'

/**
 * t pushed to linger round the middle (where A and B are both half there): a wider band of in-between shapes under
 * the brush, and they last longer as the brush comes and goes. 0 and 1 stay put.
 */
export function glitchHold(t: number, amount: number): number {
  if (!(t > 0)) return 0
  if (t >= 1) return 1
  const u = 2 * t - 1
  const p = 1 + 2.2 * Math.min(1, Math.max(0, amount))
  return 0.5 + 0.5 * Math.sign(u) * Math.abs(u) ** p
}

export interface GlitchParams {
  amount: number
  /** Seconds, for the slow drift of the tears. */
  time: number
  /** The font size in canvas pixels (sets the slices and how far they move). */
  size: number
  /** The glyph's index, so letters tear differently. */
  glyph: number
  /** The glyph's origin (canvas pixels). */
  ox: number
  oy: number
}

/**
 * How far (canvas pixels) an anchor at (x, y) with morph amount `t` moves: horizontal slices shift sideways (some a
 * lot, most not at all, so the outline breaks and tears where they meet), a band stretches out from a drifting centre,
 * and the whole lot is scaled by sin(πt), 0 at both ends.
 */
export function glitchOffset(x: number, y: number, t: number, p: GlitchParams): [number, number] {
  if (!(t > 0) || t >= 1 || !(p.amount > 0)) return [0, 0]
  const mid = Math.sin(Math.PI * t) * p.amount
  const size = Math.max(1, p.size)
  const g = p.glyph * 7.13
  const time = p.time
  // Slices: font-size-relative bands fixed to the glyph. Anchors are read at their A position, which never moves, so
  // an anchor stays in its slice and only the slice's smooth-in-time values change: no jumps between frames.
  const sliceH = size * 0.085
  const sy = (y - p.oy) / sliceH + (p.glyph % 7) * 0.13
  const slice = Math.floor(sy)
  // Each slice's shift: smooth in time; small values are cut to 0 so only some slices break away.
  const n = valueNoise(slice * 1.71 + g, time * 1.3) - 0.5
  const shift = Math.sign(n) * Math.max(0, Math.abs(n) - 0.12) * 2.6
  let dx = shift * size * 0.42 * mid
  // Stretch: anchors pulled away from a centre that drifts across the letter, more in some bands than in others.
  const cx = p.ox + size * (valueNoise(g + 11.7, time * 0.4) - 0.2) * 0.8
  const band = valueNoise(slice * 0.53 + g + 40, time * 0.5)
  dx += (x - cx) * mid * 0.55 * band * band
  // A little vertical smear: the slice edges pull apart, so the break opens.
  const frac = sy - slice
  const dy = (frac < 0.5 ? -1 : 1) * Math.abs(shift) * size * 0.05 * mid
  return [dx, dy]
}

/**
 * The trail: a channel that follows `src` up at once and falls back over `ms` (exponential), so what the brush left
 * lingers. Writes `out`, returns whether any cell is still above `src` (still falling back).
 */
export function trailStep(out: Float32Array, src: Float32Array, dtMs: number, ms: number): boolean {
  const keep = ms > 0 ? Math.exp(-Math.max(0, dtMs) / ms) : 0
  let any = false
  for (let i = 0; i < out.length; i++) {
    let v = out[i] * keep
    if (v < 1 / 512) v = 0
    const s = src[i]
    if (v > s) {
      out[i] = v
      any = true
    } else out[i] = s
  }
  return any
}
