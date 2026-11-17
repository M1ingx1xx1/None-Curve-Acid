// The brush mask: a low-resolution grid over the canvas with two channels, both 0–1. `morph` sets how far each anchor
// goes from A to B; `color` how much acid colour (it reaches colorExtra further). Hold keeps every stroke until Clear;
// decay and follow fade each cell from the last value it was stamped to along the fade curve. Pure: no DOM.

import { brushFalloff, brushReach, valueNoise } from './brush'
import { ease, type EaseName } from './easing'

export interface StampParams {
  /** Canvas pixels. */
  radius: number
  hardness: number
  strength: number
  edgeNoise: number
  colorExtra: number
}

export interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export type FadeMode = 'hold' | 'fade'

export class MaskField {
  readonly cols: number
  readonly rows: number
  /** Canvas pixels per cell. */
  readonly cell: number
  readonly morph: Float32Array
  readonly color: Float32Array
  private readonly peakM: Float32Array
  private readonly peakC: Float32Array
  private readonly age: Float32Array
  /** Cells that may be above 0 (inclusive cell bounds), or null when all are 0. */
  private active: Rect | null = null
  /** Canvas pixels that changed since takeDirty(). */
  private dirty: Rect | null = null
  /** Bumped on every change. */
  version = 0

  constructor(width: number, height: number, cell: number) {
    this.cell = cell
    this.cols = Math.max(1, Math.ceil(width / cell))
    this.rows = Math.max(1, Math.ceil(height / cell))
    const n = this.cols * this.rows
    this.morph = new Float32Array(n)
    this.color = new Float32Array(n)
    this.peakM = new Float32Array(n)
    this.peakC = new Float32Array(n)
    this.age = new Float32Array(n)
  }

  clear(): void {
    if (this.active) this.markCells(this.active)
    this.morph.fill(0)
    this.color.fill(0)
    this.peakM.fill(0)
    this.peakC.fill(0)
    this.age.fill(0)
    this.active = null
    this.version++
  }

  /** One dab of the brush at canvas point (x, y); each cell keeps the higher of its value and the dab's. */
  stamp(x: number, y: number, p: StampParams): void {
    if (!(p.radius > 0) || !(p.strength > 0)) return
    const reach = p.radius * (1 + Math.max(0, p.colorExtra)) * brushReach(p.hardness) * (1 + 0.5 * p.edgeNoise)
    const c = this.cell
    const i0 = Math.max(0, Math.floor((x - reach) / c))
    const i1 = Math.min(this.cols - 1, Math.floor((x + reach) / c))
    const j0 = Math.max(0, Math.floor((y - reach) / c))
    const j1 = Math.min(this.rows - 1, Math.floor((y + reach) / c))
    if (i0 > i1 || j0 > j1) return
    const colorRadius = p.radius * (1 + Math.max(0, p.colorExtra))
    const noiseScale = 1 / Math.max(1e-6, p.radius * 0.55)
    for (let j = j0; j <= j1; j++) {
      const py = (j + 0.5) * c
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * c
        const d = Math.hypot(px - x, py - y)
        // An uneven edge: the distance stretched or shrunk by noise fixed to the canvas, so overlapping dabs agree.
        let warp = 1
        if (p.edgeNoise > 0) {
          const n =
            0.65 * valueNoise(px * noiseScale, py * noiseScale) +
            0.35 * valueNoise(px * noiseScale * 2.7 + 17, py * noiseScale * 2.7)
          warp = 1 + p.edgeNoise * 0.7 * (n - 0.5)
        }
        const m = brushFalloff((d * warp) / p.radius, p.hardness) * p.strength
        const col = brushFalloff((d * warp) / colorRadius, p.hardness) * p.strength
        const k = j * this.cols + i
        if (m > this.morph[k] || col > this.color[k]) {
          this.peakM[k] = Math.max(this.morph[k], m)
          this.peakC[k] = Math.max(this.color[k], col)
          this.morph[k] = this.peakM[k]
          this.color[k] = this.peakC[k]
          this.age[k] = 0
        }
      }
    }
    const cells = { x0: i0, y0: j0, x1: i1, y1: j1 }
    this.active = union(this.active, cells)
    this.markCells(cells)
    this.version++
  }

  /** Dabs from (x0, y0) to (x1, y1), a quarter radius apart, so a fast stroke stays unbroken. */
  stroke(x0: number, y0: number, x1: number, y1: number, p: StampParams): void {
    const steps = Math.min(256, Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, p.radius * 0.25))))
    for (let s = 1; s <= steps; s++) this.stamp(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, p)
  }

  /** Moves time on by `dtMs`: in 'fade' every stamped cell falls from its peak to 0 over `decayMs` along `curve`. */
  step(dtMs: number, mode: FadeMode, decayMs: number, curve: EaseName): void {
    if (mode === 'hold' || !this.active || !(dtMs > 0)) return
    const a = this.active
    this.markCells(a)
    let nx0 = Infinity
    let ny0 = Infinity
    let nx1 = -1
    let ny1 = -1
    const span = Math.max(1, decayMs)
    for (let j = a.y0; j <= a.y1; j++) {
      for (let i = a.x0; i <= a.x1; i++) {
        const k = j * this.cols + i
        if (this.peakM[k] <= 0 && this.peakC[k] <= 0) continue
        const age = (this.age[k] += dtMs)
        if (age >= span) {
          this.peakM[k] = this.peakC[k] = this.morph[k] = this.color[k] = 0
          continue
        }
        const keep = 1 - ease(curve, age / span)
        this.morph[k] = this.peakM[k] * keep
        this.color[k] = this.peakC[k] * keep
        if (i < nx0) nx0 = i
        if (i > nx1) nx1 = i
        if (j < ny0) ny0 = j
        ny1 = j
      }
    }
    this.active = nx1 >= 0 ? { x0: nx0, y0: ny0, x1: nx1, y1: ny1 } : null
    this.version++
  }

  /** A channel at canvas point (x, y), bilinear between cell centres. */
  sample(channel: Float32Array, x: number, y: number): number {
    const fx = Math.min(this.cols - 1, Math.max(0, x / this.cell - 0.5))
    const fy = Math.min(this.rows - 1, Math.max(0, y / this.cell - 0.5))
    const i = Math.min(this.cols - 2, Math.floor(fx))
    const j = Math.min(this.rows - 2, Math.floor(fy))
    if (i < 0 || j < 0) return channel[Math.round(fy) * this.cols + Math.round(fx)]
    const tx = fx - i
    const ty = fy - j
    const k = j * this.cols + i
    const a = channel[k]
    const b = channel[k + 1]
    const c = channel[k + this.cols]
    const d = channel[k + this.cols + 1]
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty
  }

  /** Canvas pixels changed since the last call (a cell's margin included), or null; resets it. */
  takeDirty(): Rect | null {
    const d = this.dirty
    this.dirty = null
    return d
  }

  private markCells(r: Rect): void {
    const c = this.cell
    this.dirty = union(this.dirty, { x0: (r.x0 - 1) * c, y0: (r.y0 - 1) * c, x1: (r.x1 + 2) * c, y1: (r.y1 + 2) * c })
  }
}

function union(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b }
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1
}
