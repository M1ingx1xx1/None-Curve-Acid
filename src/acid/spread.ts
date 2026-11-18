// Spread: a mask channel blurred wide and laid under itself, so a stroke reaches further out than the brush with a soft
// falloff, nearby strokes join into one patch, and a fading stroke thins out as it widens. Three box blurs in each
// direction (close to a Gaussian), each a running sum, so the cost does not grow with the radius. Only the cells that
// can be above 0 are worked on: the painted extent and the blur's reach round it. Pure.

import type { Rect } from './mask'

/** One box blur of `radius` cells along each row, for rows y0–y1 and positions x0–x1 of `r`; grid edges clamp. */
function rowPass(src: Float32Array, dst: Float32Array, cols: number, radius: number, r: Rect) {
  const inv = 1 / (2 * radius + 1)
  const last = cols - 1
  for (let l = r.y0; l <= r.y1; l++) {
    const base = l * cols
    let sum = 0
    for (let i = r.x0 - radius; i <= r.x0 + radius; i++) sum += src[base + (i < 0 ? 0 : i > last ? last : i)]
    for (let i = r.x0; i <= r.x1; i++) {
      dst[base + i] = sum * inv
      const add = i + radius + 1
      const sub = i - radius
      sum += src[base + (add > last ? last : add)] - src[base + (sub < 0 ? 0 : sub)]
    }
  }
}

/**
 * One box blur of `radius` cells along each column, for columns x0–x1 and positions y0–y1 of `r`; grid edges clamp.
 * Row by row with a running sum per column, so memory is read in order.
 */
function columnPass(
  src: Float32Array,
  dst: Float32Array,
  cols: number,
  rows: number,
  radius: number,
  r: Rect,
  sums: Float64Array,
) {
  const inv = 1 / (2 * radius + 1)
  const last = rows - 1
  const w = r.x1 - r.x0 + 1
  sums.fill(0, 0, w)
  for (let j = r.y0 - radius; j <= r.y0 + radius; j++) {
    const base = (j < 0 ? 0 : j > last ? last : j) * cols + r.x0
    for (let x = 0; x < w; x++) sums[x] += src[base + x]
  }
  for (let j = r.y0; j <= r.y1; j++) {
    const out = j * cols + r.x0
    const add = j + radius + 1
    const sub = j - radius
    const a = (add > last ? last : add) * cols + r.x0
    const b = (sub < 0 ? 0 : sub) * cols + r.x0
    for (let x = 0; x < w; x++) {
      dst[out + x] = sums[x] * inv
      sums[x] += src[a + x] - src[b + x]
    }
  }
}

function fillRect(a: Float32Array, cols: number, r: Rect): void {
  for (let j = r.y0; j <= r.y1; j++) a.fill(0, j * cols + r.x0, j * cols + r.x1 + 1)
}

/** A channel spread, kept between frames so each frame only touches the cells that can be above 0. */
export class Spread {
  out: Float32Array
  private tmp: Float32Array
  private sums: Float64Array
  /** Where out and tmp were last written; 0 everywhere else. */
  private last: Rect | null = null

  constructor(size: number) {
    this.out = new Float32Array(size)
    this.tmp = new Float32Array(size)
    this.sums = new Float64Array(size)
  }

  /**
   * `src` spread by about `radius` cells into `out`: the larger of the cell and its blurred surroundings (lifted by
   * `gain`, so a patch between strokes fills in). `extent`: the cells of `src` that may be above 0 (null: none).
   */
  run(src: Float32Array, cols: number, rows: number, radius: number, extent: Rect | null, gain = 1.6): Float32Array {
    // Three boxes of radius r have a spread close to a Gaussian of sigma r, and reach 3r.
    const r = Math.max(1, Math.round(radius / 1.7))
    const last = this.last
    this.last = null
    if (!extent) {
      if (last) {
        fillRect(this.out, cols, last)
        fillRect(this.tmp, cols, last)
      }
      return this.out
    }
    const reach = 3 * r
    const box: Rect = {
      x0: Math.max(0, extent.x0 - reach),
      y0: Math.max(0, extent.y0 - reach),
      x1: Math.min(cols - 1, extent.x1 + reach),
      y1: Math.min(rows - 1, extent.y1 + reach),
    }
    // What was written last time and falls outside the new box goes back to 0; inside it is written over anyway.
    if (last && (last.x0 < box.x0 || last.y0 < box.y0 || last.x1 > box.x1 || last.y1 > box.y1)) {
      fillRect(this.out, cols, last)
      fillRect(this.tmp, cols, last)
    }
    this.last = box
    const { out, tmp } = this
    const { sums } = this
    rowPass(src, out, cols, r, box)
    rowPass(out, tmp, cols, r, box)
    rowPass(tmp, out, cols, r, box)
    columnPass(out, tmp, cols, rows, r, box, sums)
    columnPass(tmp, out, cols, rows, r, box, sums)
    columnPass(out, tmp, cols, rows, r, box, sums)
    for (let j = box.y0; j <= box.y1; j++)
      for (let k = j * cols + box.x0, end = j * cols + box.x1; k <= end; k++)
        out[k] = Math.max(src[k], Math.min(1, tmp[k] * gain))
    return out
  }
}
