import { describe, expect, it } from 'vitest'
import { spreadField } from '../src/acid/spread'

describe('spreadField', () => {
  const cols = 41
  const rows = 21
  const at = (x: number, y: number) => y * cols + x

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
