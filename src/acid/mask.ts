// The brush mask: a low-resolution grid over the canvas with two channels, both 0–1. `morph` sets how far each anchor
// goes from A to B; `color` how much acid colour (it reaches colorExtra further). Hold keeps every stroke until Clear;
// decay and follow fade each cell from the last value it was stamped to along the fade curve. With a rise time a cell
// seeps up to the value it was stamped to instead of jumping there (morph and colour each with their own). Pure: no DOM.

import { brushFalloff, brushReach, valueNoise } from './brush'
import { ease, type EaseName } from './easing'

export interface StampParams {
  /** Canvas pixels. */
  radius: number
  hardness: number
  strength: number
  edgeNoise: number
  colorExtra: number
  /** 0–1: the stamp's outline pushed about by broad noise, so a big brush is not a circle. */
  shapeWarp?: number
  /** 0–1: patches inside the stamp weaker than others. */
  density?: number
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
  /** Where each cell is heading now (the peak as it fades); morph and color rise towards it. */
  private readonly goalM: Float32Array
  private readonly goalC: Float32Array
  private readonly age: Float32Array
  /** Rise times (ms): 0 jumps to the stamped value. */
  riseMorphMs = 0
  riseColorMs = 0
  /** Cells that may be above 0 (inclusive cell bounds), or null when all are 0. */
  private active: Rect | null = null
  /** Cells stamped since the last clear (inclusive cell bounds), or null. */
  private touched: Rect | null = null
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
    this.goalM = new Float32Array(n)
    this.goalC = new Float32Array(n)
    this.age = new Float32Array(n)
  }

  clear(): void {
    if (this.touched) this.markCells(this.touched)
    this.morph.fill(0)
    this.color.fill(0)
    this.peakM.fill(0)
    this.peakC.fill(0)
    this.goalM.fill(0)
    this.goalC.fill(0)
    this.age.fill(0)
    this.active = null
    this.touched = null
    this.version++
  }

  /** One dab of the brush at canvas point (x, y); each cell keeps the higher of its value and the dab's. */
  stamp(x: number, y: number, p: StampParams): void {
    if (!(p.radius > 0) || !(p.strength > 0)) return
    const shapeWarp = p.shapeWarp ?? 0
    const density = p.density ?? 0
    const reach =
      p.radius * (1 + Math.max(0, p.colorExtra)) * brushReach(p.hardness) * (1 + 0.5 * p.edgeNoise) +
      shapeWarp * p.radius * 0.6
    const c = this.cell
    const i0 = Math.max(0, Math.floor((x - reach) / c))
    const i1 = Math.min(this.cols - 1, Math.floor((x + reach) / c))
    const j0 = Math.max(0, Math.floor((y - reach) / c))
    const j1 = Math.min(this.rows - 1, Math.floor((y + reach) / c))
    if (i0 > i1 || j0 > j1) return
    const colorRadius = p.radius * (1 + Math.max(0, p.colorExtra))
    const noiseScale = 1 / Math.max(1e-6, p.radius * 0.55)
    const broad = 1 / Math.max(1e-6, p.radius * 1.6)
    const rise = this.riseMorphMs > 0 || this.riseColorMs > 0
    const noise = this.noiseFor(p.radius)
    // Cells the dab cannot raise are skipped before the noise: those already at full strength, and those beyond the
    // furthest the warped, noisy edge can reach (colour reaches further than morph).
    const cut = colorRadius * brushReach(p.hardness) * (1 + 1e-9) + 1e-6
    const shiftMax = 0.85 * shapeWarp * p.radius
    const warpMin = 1 - 0.35 * Math.max(0, p.edgeNoise)
    for (let j = j0; j <= j1; j++) {
      const py = (j + 0.5) * c
      for (let i = i0; i <= i1; i++) {
        const k = j * this.cols + i
        if (this.goalM[k] >= p.strength && this.goalC[k] >= p.strength) continue
        const px = (i + 0.5) * c
        if (warpMin > 0 && (Math.sqrt((px - x) ** 2 + (py - y) ** 2) - shiftMax) * warpMin > cut) continue
        let d: number
        if (shapeWarp > 0) {
          // The cell seen from a point pushed about by broad noise fixed to the canvas: the outline stretches out in
          // some directions and pulls in in others, and overlapping dabs agree.
          let wx = noise.wx[k]
          if (wx !== wx) {
            wx = noise.wx[k] = valueNoise(px * broad + 41, py * broad) - 0.5
            noise.wy[k] = valueNoise(px * broad, py * broad + 73) - 0.5
          }
          const wy = noise.wy[k]
          d = Math.hypot(px + wx * shapeWarp * p.radius * 1.2 - x, py + wy * shapeWarp * p.radius * 1.2 - y)
        } else d = Math.hypot(px - x, py - y)
        // An uneven edge: the distance stretched or shrunk by noise fixed to the canvas, so overlapping dabs agree.
        let warp = 1
        if (p.edgeNoise > 0) {
          let n = noise.edge[k]
          if (n !== n)
            n = noise.edge[k] =
              0.65 * valueNoise(px * noiseScale, py * noiseScale) +
              0.35 * valueNoise(px * noiseScale * 2.7 + 17, py * noiseScale * 2.7)
          warp = 1 + p.edgeNoise * 0.7 * (n - 0.5)
        }
        // Heavier and lighter patches.
        let weight = p.strength
        if (density > 0) {
          let patch = noise.patch[k]
          if (patch !== patch)
            patch = noise.patch[k] = smoothstepNoise(valueNoise(px * noiseScale * 0.7 - 9, py * noiseScale * 0.7))
          weight = p.strength * (1 - density * patch)
        }
        const m = brushFalloff((d * warp) / p.radius, p.hardness) * weight
        const col = brushFalloff((d * warp) / colorRadius, p.hardness) * weight
        if (m > this.goalM[k] || col > this.goalC[k]) {
          this.peakM[k] = this.goalM[k] = Math.max(this.goalM[k], m)
          this.peakC[k] = this.goalC[k] = Math.max(this.goalC[k], col)
          if (!rise) {
            this.morph[k] = this.peakM[k]
            this.color[k] = this.peakC[k]
          }
          this.age[k] = 0
        }
      }
    }
    const cells = { x0: i0, y0: j0, x1: i1, y1: j1 }
    this.active = union(this.active, cells)
    this.touched = union(this.touched, cells)
    this.markCells(cells)
    this.version++
  }

  /** Dabs from (x0, y0) to (x1, y1), a quarter radius apart, so a fast stroke stays unbroken. */
  stroke(x0: number, y0: number, x1: number, y1: number, p: StampParams): void {
    const steps = Math.min(256, Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, p.radius * 0.25))))
    for (let s = 1; s <= steps; s++) this.stamp(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, p)
  }

  /**
   * Moves time on by `dtMs`: cells rise towards their stamped value over the rise times, and in 'fade' every stamped
   * cell falls from its peak to 0 over `decayMs` along `curve` (after it has risen).
   */
  step(dtMs: number, mode: FadeMode, decayMs: number, curve: EaseName): void {
    const riseM = this.riseMorphMs
    const riseC = this.riseColorMs
    if (mode === 'hold' && !(riseM > 0) && !(riseC > 0)) return
    if (!(this.active || (mode === 'fade' && this.touched)) || !(dtMs > 0)) return
    // Fading covers every stamped cell, also those a hold with a rise time let go of once they had risen.
    const a = (mode === 'fade' && this.touched ? this.touched : this.active)!
    let nx0 = Infinity
    let ny0 = Infinity
    let nx1 = -1
    let ny1 = -1
    let cx0 = Infinity
    let cy0 = Infinity
    let cx1 = -1
    let cy1 = -1
    const span = Math.max(1, decayMs)
    const delay = Math.max(riseM, riseC)
    for (let j = a.y0; j <= a.y1; j++) {
      for (let i = a.x0; i <= a.x1; i++) {
        const k = j * this.cols + i
        if (this.peakM[k] <= 0 && this.peakC[k] <= 0) continue
        const age = (this.age[k] += dtMs)
        const m0 = this.morph[k]
        const c0 = this.color[k]
        let keep = 1
        if (mode === 'fade') {
          const fadeAge = age - delay
          keep = fadeAge <= 0 ? 1 : fadeAge >= span ? 0 : 1 - ease(curve, fadeAge / span)
        }
        if (keep <= 0) {
          this.peakM[k] = this.peakC[k] = this.goalM[k] = this.goalC[k] = this.morph[k] = this.color[k] = 0
        } else {
          const gm = (this.goalM[k] = this.peakM[k] * keep)
          const gc = (this.goalC[k] = this.peakC[k] * keep)
          this.morph[k] = riseM > 0 && m0 < gm ? Math.min(gm, m0 + (this.peakM[k] * dtMs) / riseM) : gm
          this.color[k] = riseC > 0 && c0 < gc ? Math.min(gc, c0 + (this.peakC[k] * dtMs) / riseC) : gc
        }
        if (this.morph[k] !== m0 || this.color[k] !== c0) {
          if (i < cx0) cx0 = i
          if (i > cx1) cx1 = i
          if (j < cy0) cy0 = j
          cy1 = j
        }
        // Hold keeps a cell for good once it has risen; fade keeps it until it is gone.
        if (keep > 0 && (mode === 'fade' || this.morph[k] < this.goalM[k] || this.color[k] < this.goalC[k])) {
          if (i < nx0) nx0 = i
          if (i > nx1) nx1 = i
          if (j < ny0) ny0 = j
          ny1 = j
        }
      }
    }
    this.active = nx1 >= 0 ? { x0: nx0, y0: ny0, x1: nx1, y1: ny1 } : null
    // When fading, every cell above 0 is active.
    if (mode === 'fade') this.touched = this.active && { ...this.active }
    if (cx1 >= 0) {
      this.markCells({ x0: cx0, y0: cy0, x1: cx1, y1: cy1 })
      this.version++
    }
  }

  /**
   * The noise a stamp of `radius` reads at each cell (fixed to the canvas, so the same for every dab), worked out the
   * first time a dab reaches the cell; NaN until then.
   */
  private noiseFor(radius: number) {
    if (!this.noise || this.noise.radius !== radius) {
      const n = this.cols * this.rows
      const fresh = () => new Float64Array(n).fill(NaN)
      this.noise = { radius, wx: fresh(), wy: fresh(), edge: fresh(), patch: fresh() }
    }
    return this.noise
  }
  private noise: {
    radius: number
    wx: Float64Array
    wy: Float64Array
    edge: Float64Array
    patch: Float64Array
  } | null = null

  /** Cells that may be above 0 (inclusive cell bounds), or null when all are 0. */
  get extent(): Rect | null {
    return this.touched
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

/** Noise pushed towards 0 and 1, so patches read as patches. */
function smoothstepNoise(n: number): number {
  const t = Math.min(1, Math.max(0, (n - 0.3) / 0.4))
  return t * t * (3 - 2 * t)
}

function union(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b }
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1
}
