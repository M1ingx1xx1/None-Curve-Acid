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

/** Without pointer moves for this long (ms), the auto brush takes over again. */
export const AUTO_HANDBACK_MS = 1500

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

    this.moveBrush(now, dt, s, mask)
    mask.step(dt, s.mode === 'hold' ? 'hold' : 'fade', s.decayMs, s.fadeEase)

    const shaping: MorphShaping = { band: s.band, maxMorph: s.maxMorph, morphEase: s.morphEase }
    const shapingKey = JSON.stringify([shaping, s.perGlyph])
    if (shapingKey !== this.shapingKey) {
      this.shapingKey = shapingKey
      for (const g of this.glyphs) g.stale = true
    }
    const dirty = mask.takeDirty()
    const tAt = (x: number, y: number) => morphAmount(mask.sample(mask.morph, x, y), shaping)
    let changed = layoutChanged ? 1 : 0
    this.morphed = 0
    for (const g of this.glyphs) {
      if (g.stale || (dirty && intersects(g.box, dirty))) {
        const before = g.maxT
        morphGlyph(g, tAt, s.perGlyph)
        // A glyph that was and is still all A needs no new vertices.
        if (before !== 0 || g.maxT !== 0) changed++
        this.morphed++
      }
    }
    if (changed) this.uploadGlyphs()
    if (mask.version !== this.maskVersion) {
      this.maskVersion = mask.version
      this.renderer.uploadMask(mask.morph, mask.color)
    }
    this.renderer.render({ ...s, bleed: s.bleed, time: (now - this.start) / 1000 })
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
