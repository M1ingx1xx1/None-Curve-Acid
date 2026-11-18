// One frame of the tool: move the brush (pointer, spring, auto path), stamp and fade the mask, morph the glyphs the
// mask changed under (the others keep their last shape), and draw. The text is laid out and paired again only when
// the fonts, the text or the layout settings change.

import type { LoadedFont } from '../font/parse'
import { applyCase, canvasSize, type Settings } from '../state/settings'
import { morphAmount, type MorphShaping } from './brush'
import { intersects, MaskField, type StampParams } from './mask'
import { Spring2, sweepPath, type Point2 } from './motion'
import { AcidRenderer } from './renderer'
import { layoutScene, morphGlyph, type PlacedGlyph } from './scene'
import { Spread } from './spread'

/** Without pointer moves for this long (ms), the auto brush takes over again. */
export const AUTO_HANDBACK_MS = 1500

/** Spread at 1 reaches this many brush radii past the stroke. */
const SPREAD_RADII = 1.5

/** A hash of two integers into 0–1 (the strobe's per-letter jumps). */
function hash01(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** The strobe's t for a glyph: `t` pushed up or down by up to `amount` of the way, fixed for one hold period. */
export function strobeT(t: number, amount: number, glyph: number, period: number): number {
  // Only letters the brush has reached: not ones a blur's rounding left a trace of t on.
  if (!(t > 1e-4)) return t
  const r = hash01(glyph, period) * 2 - 1
  return Math.min(1, Math.max(0, r > 0 ? t + r * amount * (1 - t) : t + r * amount * t))
}

/** The mask cell size (canvas pixels) for a canvas `height` pixels tall: about 320 rows. */
export function maskCell(height: number): number {
  return Math.max(2, Math.round(height / 320))
}

export class AcidEngine {
  readonly canvas: HTMLCanvasElement
  private renderer: AcidRenderer
  private mask: MaskField | null = null
  private glyphs: PlacedGlyph[] = []
  private layoutKey = ''
  private shapingKey = ''
  private maskVersion = -1
  private vertices = new Float32Array(1 << 16)
  private width = 0
  private height = 0
  private last = 0
  private start = 0
  private pointer = { x: 0, y: 0, inside: false, pressed: false, movedAt: -Infinity }
  private spring = new Spring2({ x: 0, y: 0 })
  private brushPrev: Point2 | null = null
  private autoTime = 0
  private autoWas = false
  /** The mask's channels after Spread (the mask's own arrays when there is none). */
  private fieldM: Float32Array | null = null
  private fieldC: Float32Array | null = null
  private spreadM: Spread | null = null
  private spreadC: Spread | null = null
  private spreadKey = ''
  private strobePeriod = -1
  /** Average frame time (ms). */
  frameMs = 16.7
  /** Glyphs morphed on the last frame. */
  morphed = 0
  /** Where the brush is drawn (canvas pixels), or null when it is not painting. */
  brush: Point2 | null = null
  autoActive = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new AcidRenderer(canvas)
  }

  get size() {
    return { width: this.width, height: this.height }
  }

  pointerMove(x: number, y: number, pressed: boolean, now: number): void {
    this.pointer.x = x
    this.pointer.y = y
    this.pointer.inside = true
    this.pointer.pressed = pressed
    this.pointer.movedAt = now
  }

  pointerLeave(): void {
    this.pointer.inside = false
    this.pointer.pressed = false
  }

  clear(): void {
    this.mask?.clear()
    this.brushPrev = null
  }

  /** Advances to `now` (ms) and draws. */
  frame(now: number, s: Settings, fontA: LoadedFont | null, fontB: LoadedFont | null): void {
    if (!this.start) this.start = now
    const dt = this.last ? Math.min(100, now - this.last) : 16.7
    this.last = now
    this.frameMs += (dt - this.frameMs) * 0.05

    const { width, height } = canvasSize(s)
    if (width !== this.width || height !== this.height || !this.mask) {
      this.width = width
      this.height = height
      const cell = maskCell(height)
      this.mask = new MaskField(width, height, cell)
      this.renderer.resize(width, height, this.mask.cols, this.mask.rows, cell)
      this.layoutKey = ''
      this.maskVersion = -1
      this.spring.reset({ x: width / 2, y: height / 2 })
    }
    const mask = this.mask

    let layoutChanged = false
    if (fontA && fontB) {
      const text = applyCase(s.text, s.letterCase)
      const key = JSON.stringify([
        fontA.id,
        fontB.id,
        text,
        s.align,
        s.fontSize,
        s.lineHeight,
        s.tracking,
        s.anchorDensity,
        width,
        height,
      ])
      if (key !== this.layoutKey) {
        this.layoutKey = key
        this.glyphs = layoutScene(fontA, fontB, { ...s, text }, width, height)
        layoutChanged = true
      }
    } else if (this.glyphs.length) {
      this.glyphs = []
      this.layoutKey = ''
      layoutChanged = true
    }

    mask.riseColorMs = s.seepMs
    mask.riseMorphMs = s.seepMs + s.morphLag
    this.moveBrush(now, dt, s, mask)
    mask.step(dt, s.mode === 'hold' ? 'hold' : 'fade', s.decayMs, s.fadeEase)

    const shaping: MorphShaping = { band: s.band, maxMorph: s.maxMorph, morphEase: s.morphEase }
    const shapingKey = JSON.stringify([shaping, s.perGlyph, s.strobe, s.strobeAmount])
    if (shapingKey !== this.shapingKey) {
      this.shapingKey = shapingKey
      for (const g of this.glyphs) g.stale = true
    }
    let dirty = mask.takeDirty()

    // Spread: the channels blurred wide under themselves; recomputed when the mask or the spread changes.
    const spreadKey = JSON.stringify([s.spread, s.morphSpread, s.radius, mask.cols, mask.rows])
    const maskChanged = mask.version !== this.maskVersion || spreadKey !== this.spreadKey
    if (maskChanged) {
      if (spreadKey !== this.spreadKey) {
        this.spreadKey = spreadKey
        for (const g of this.glyphs) g.stale = true
      }
      this.spreadM = s.morphSpread > 0 ? this.spreadFor(this.spreadM, mask) : null
      this.spreadC = s.spread > 0 ? this.spreadFor(this.spreadC, mask) : null
      this.fieldM = this.spreadM && this.spreadChannel(this.spreadM, mask, mask.morph, s.morphSpread, s.radius)
      this.fieldC = this.spreadC && this.spreadChannel(this.spreadC, mask, mask.color, s.spread, s.radius)
    }
    const fieldM = this.fieldM ?? mask.morph
    const fieldC = this.fieldC ?? mask.color
    if (dirty && s.morphSpread > 0) {
      const pad = s.morphSpread * SPREAD_RADII * s.radius * height
      dirty = { x0: dirty.x0 - pad, y0: dirty.y0 - pad, x1: dirty.x1 + pad, y1: dirty.y1 + pad }
    }

    // Strobe: each hold period every letter under the brush jumps to its own shape.
    const period = s.strobe ? Math.floor((now - this.start) / Math.max(16, s.strobeHoldMs)) : -1
    const strobeTick = period !== this.strobePeriod
    this.strobePeriod = period
    const tBase = (x: number, y: number) => morphAmount(mask.sample(fieldM, x, y), shaping)
    let changed = layoutChanged ? 1 : 0
    this.morphed = 0
    for (let gi = 0; gi < this.glyphs.length; gi++) {
      const g = this.glyphs[gi]
      if (g.stale || (dirty && intersects(g.box, dirty)) || (strobeTick && g.maxT > 0)) {
        const before = g.maxT
        const tAt = s.strobe ? (x: number, y: number) => strobeT(tBase(x, y), s.strobeAmount, gi, period) : tBase
        morphGlyph(g, tAt, s.perGlyph)
        // A glyph that was and is still all A needs no new vertices.
        if (before !== 0 || g.maxT !== 0) changed++
        this.morphed++
      }
    }
    if (changed) this.uploadGlyphs()
    if (maskChanged) {
      this.maskVersion = mask.version
      this.renderer.uploadMask(fieldM, fieldC)
    }
    this.renderer.render({ ...s, bleed: s.bleed, time: (now - this.start) / 1000 })
  }

  /** `spread` when it fits the mask, else a new one. */
  private spreadFor(spread: Spread | null, mask: MaskField): Spread {
    return spread && spread.out.length === mask.cols * mask.rows ? spread : new Spread(mask.cols * mask.rows)
  }

  /** `src` spread by `amount` of SPREAD_RADII brush radii. */
  private spreadChannel(spread: Spread, mask: MaskField, src: Float32Array, amount: number, radius: number) {
    const cells = (amount * SPREAD_RADII * radius * this.height) / mask.cell
    return spread.run(src, mask.cols, mask.rows, cells, mask.extent)
  }

  private moveBrush(now: number, dt: number, s: Settings, mask: MaskField): void {
    const p = this.pointer
    // Auto mode sweeps on its own; the pointer takes over while it moves and hands back after AUTO_HANDBACK_MS.
    const auto = s.mode === 'auto' && now - p.movedAt > AUTO_HANDBACK_MS
    if (auto) this.autoTime += (dt / 1000) * s.autoSpeed
    let at: Point2
    let painting: boolean
    if (auto) {
      const q = sweepPath(s.autoX, s.autoY, s.autoAngle, this.autoTime, this.width / this.height, s.radius)
      at = this.spring.step({ x: q.x * this.width, y: q.y * this.height }, dt, s.spring)
      painting = true
    } else if (s.mode === 'follow' || s.mode === 'auto') {
      at = this.spring.step({ x: p.x, y: p.y }, dt, s.spring)
      painting = p.inside
    } else {
      // Hold and decay paint where the pointer is, while pressed.
      at = { x: p.x, y: p.y }
      this.spring.reset(at)
      painting = p.inside && p.pressed
    }
    // A hand-over between the auto path and the pointer starts a new stroke.
    if (auto !== this.autoWas) this.brushPrev = null
    this.autoWas = auto
    this.autoActive = auto
    this.brush = painting ? at : null
    if (!painting) {
      this.brushPrev = null
      return
    }
    const stamp: StampParams = {
      radius: s.radius * this.height,
      hardness: s.hardness,
      strength: s.strength,
      edgeNoise: s.edgeNoise,
      colorExtra: s.colorExtra,
      shapeWarp: s.shapeWarp,
      density: s.density,
    }
    if (this.brushPrev) mask.stroke(this.brushPrev.x, this.brushPrev.y, at.x, at.y, stamp)
    else mask.stamp(at.x, at.y, stamp)
    this.brushPrev = at
  }

  /** Triangle fans of every contour as drawn now. */
  private uploadGlyphs(): void {
    let need = 0
    for (const g of this.glyphs) for (const c of g.shape) need += Math.max(0, c.length / 2 - 2) * 6
    if (need > this.vertices.length) this.vertices = new Float32Array(Math.max(need, this.vertices.length * 2))
    const v = this.vertices
    let k = 0
    for (const g of this.glyphs)
      for (const c of g.shape) {
        const n = c.length / 2
        for (let i = 1; i < n - 1; i++) {
          v[k++] = c[0]
          v[k++] = c[1]
          v[k++] = c[2 * i]
          v[k++] = c[2 * i + 1]
          v[k++] = c[2 * i + 2]
          v[k++] = c[2 * i + 3]
        }
      }
    this.renderer.setGlyphs(v, k / 2)
  }

  dispose(): void {
    this.renderer.dispose()
  }
}
