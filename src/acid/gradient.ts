// The acid gradient's colour stops and direction, as the shader reads them (renderer.ts), with the same sums on the
// CPU for the tests. Adapted from None-Curve src/acid/gradient.ts: stops carry their own positions here.

import type { GradientStop } from '../state/settings'

/** Gradient Slant's quick choices (degrees). */
export const SLANT_PRESETS = [0, 45, 90, 135, 180] as const

export type Rgb = readonly [number, number, number]

/** #rrggbb → 0–1 channels (the shader mixes in sRGB, as the colour pickers show). */
export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** The stops the other way round. */
export function reverseStops(stops: readonly GradientStop[]): GradientStop[] {
  return stops.map((s) => ({ color: s.color, pos: 1 - s.pos })).sort((a, b) => a.pos - b.pos)
}

/**
 * The unit direction the gradient runs in for Gradient Slant `degrees`, in canvas coordinates (x right, y down): 0 runs
 * left to right, 90 bottom to top, 180 right to left.
 */
export function slantDirection(degrees: number): { x: number; y: number } {
  const a = ((Number.isFinite(degrees) ? degrees : 0) * Math.PI) / 180
  const x = Math.cos(a)
  const y = -Math.sin(a)
  // No −0, so the uniforms (and the tests) see clean numbers.
  return { x: Math.abs(x) < 1e-12 ? 0 : x, y: Math.abs(y) < 1e-12 ? 0 : y }
}

/**
 * Where a point (canvas shares, x right, y down; `aspect` is width / height) sits along the gradient, 0 at its start
 * and 1 at its end before `phase` moves it, mirrored at every whole number so a flowing gradient never jumps.
 */
export function gradientPosition(x: number, y: number, aspect: number, degrees: number, phase: number): number {
  const d = slantDirection(degrees)
  const reach = Math.abs(d.x) * aspect + Math.abs(d.y)
  const s = ((x - 0.5) * aspect * d.x + (y - 0.5) * d.y) / reach + 0.5 + phase
  const m = ((s % 2) + 2) % 2
  return m > 1 ? 2 - m : m
}

/** The colour at position `t` (0–1) of stops sorted by position. */
export function gradientAt(stops: readonly GradientStop[], t: number): Rgb {
  const colors = stops.map((s) => hexToRgb(s.color))
  if (t <= stops[0].pos) return colors[0]
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].pos) {
      const span = stops[i].pos - stops[i - 1].pos
      const f = span > 0 ? (t - stops[i - 1].pos) / span : 1
      const a = colors[i - 1]
      const b = colors[i]
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
    }
  }
  return colors[colors.length - 1]
}
