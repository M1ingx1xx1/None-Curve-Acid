// The brush's curves: how a stamp falls off from its centre (hardness), how the mask value becomes the morph amount t
// (A→B band, morph curve, max morph), and the noise that makes the stamp's edge uneven. Pure.

import { ease, type EaseName } from './easing'

export const smoothstep = (e0: number, e1: number, x: number): number => {
  if (e1 <= e0) return x < e0 ? 0 : 1
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * Half the width of the falloff ring, in radii, at `hardness`: 0.9 when soft (the value ramps from 0.1 to 1.9 radii),
 * near 0 when hard (a step at the radius).
 */
export function falloffWidth(hardness: number): number {
  const h = Math.min(1, Math.max(0, hardness))
  return 0.004 + (1 - h) * 0.896
}

/** The stamp's value at `u` radii from its centre: 1 inside, 0 outside, the ring between set by `hardness`. */
export function brushFalloff(u: number, hardness: number): number {
  const s = falloffWidth(hardness)
  return 1 - smoothstep(1 - s, 1 + s, u)
}

/** How far out (in radii) a stamp reaches at all. */
export function brushReach(hardness: number): number {
  return 1 + falloffWidth(hardness)
}

export interface MorphShaping {
  band: number
  maxMorph: number
  morphEase: EaseName
}

/**
 * The morph amount t for a mask value `m` (0–1): the A→B band narrows the ramp round 0.5 (1 keeps it as it is, 0 is a
 * switch), the morph curve sets its pace, and max morph caps it (0.5: at most halfway, the average of A and B).
 */
export function morphAmount(m: number, s: MorphShaping): number {
  if (!(m > 0)) return 0
  const band = Math.min(1, Math.max(0, s.band))
  const banded = band >= 1 ? Math.min(1, m) : smoothstep(0.5 - band / 2, 0.5 + band / 2, m)
  return ease(s.morphEase, banded) * Math.min(1, Math.max(0, s.maxMorph))
}

/** A hash of two integers into 0–1. */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise in 0–1. */
export function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy)
  const b = hash2(ix + 1, iy)
  const c = hash2(ix, iy + 1)
  const d = hash2(ix + 1, iy + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}
