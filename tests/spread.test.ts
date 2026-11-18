import { describe, expect, it } from 'vitest'
import type { Rect } from '../src/acid/mask'
import { Spread } from '../src/acid/spread'

describe('Spread', () => {
  const cols = 41
  const rows = 21
  const at = (x: number, y: number) => y * cols + x
  const all: Rect = { x0: 0, y0: 0, x1: cols - 1, y1: rows - 1 }
  const spreadField = (
    src: Float32Array,
    out: Float32Array,
    _tmp: Float32Array,
    c: number,
    r: number,
    radius: number,
  ) => out.set(new Spread(src.length).run(src, c, r, radius, all))

  it('worked on the painted extent only, matches the whole grid frame after frame', () => {
    const part = new Spread(cols * rows)
    for (const [x0, y0, x1, y1] of [
      [5, 3, 12, 9],
      [20, 10, 24, 12],
      [30, 15, 40, 20],
    ]) {
      const src = new Float32Array(cols * rows)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) src[at(x, y)] = 0.3 + (0.7 * ((x * 7 + y * 3) % 5)) / 5
      const whole = new Spread(src.length).run(src, cols, rows, 4, all)
      const limited = part.run(src, cols, rows, 4, { x0, y0, x1, y1 })
      for (let i = 0; i < src.length; i++) expect(limited[i]).toBeCloseTo(whole[i], 5)
    }
    expect(part.run(new Float32Array(cols * rows), cols, rows, 4, null).every((v) => v === 0)).toBe(true)
  })

  it('keeps the source, reaches past it with a falloff, and stays in 0–1', () => {
    const src = new Float32Array(cols * rows)
    for (let y = 8; y <= 12; y++) for (let x = 18; x <= 22; x++) src[at(x, y)] = 1
    const out = new Float32Array(src.length)
    spreadField(src, out, new Float32Array(src.length), cols, rows, 6)
    for (let i = 0; i < src.length; i++) {
      expect(out[i]).toBeGreaterThanOrEqual(src[i])
      expect(out[i]).toBeLessThanOrEqual(1)
    }
    expect(out[at(26, 10)]).toBeGreaterThan(0)
    expect(out[at(26, 10)]).toBeGreaterThan(out[at(30, 10)])
    expect(out[at(0, 0)]).toBeLessThan(0.01)
  })

  it('fills the gap between two strokes', () => {
    const src = new Float32Array(cols * rows)
    for (let y = 0; y < rows; y++)
      for (let x = 13; x <= 16; x++) {
        src[at(x, y)] = 1
        src[at(x + 11, y)] = 1
      }
    const out = new Float32Array(src.length)
    spreadField(src, out, new Float32Array(src.length), cols, rows, 5)
    expect(src[at(20, 10)]).toBe(0)
    // Mid-gap, 4 cells from both strokes, against 4 cells off one stroke on the outside.
    expect(out[at(20, 10)]).toBeGreaterThan(0.3)
    expect(out[at(20, 10)]).toBeGreaterThan(out[at(31, 10)])
  })
})
