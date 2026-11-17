// The text on the canvas: laid out with font A (fontkit's shaping, so kerning applies), each glyph paired with the
// same character of font B, centred in A's advance at A's em size (never scaled up beyond that). The pairing
// (morph/pair.ts) is cached per glyph pair and only redone when the fonts or the text change; each frame only moves
// anchors (morphGlyph). Pure: no DOM.

import type { Font, Glyph } from 'fontkit'
import { glyphPolygon, placePolygon } from '../font/outline'
import { planMorph, type MorphPlan, type Track } from '../morph/pair'
import type { PolygonGlyph } from '../morph/types'
import type { Rect } from './mask'

export interface FontLike {
  id: number
  font: Font
  unitsPerEm: number
  ascent: number
  descent: number
}

export interface GlyphPair {
  tracks: Track[]
  /** Font units (A's em), y up: the box of A and B together. */
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** False when B has no glyph for the character (it stays A). */
  morphs: boolean
}

export interface PlacedGlyph {
  pair: GlyphPair
  /** Canvas = (x + fx·scale, y − fy·scale). */
  scale: number
  x: number
  y: number
  box: Rect
  /** The outline as drawn now: per track, x and y interleaved (canvas pixels). */
  shape: Float32Array[]
  /** Largest t over the anchors when it was last morphed. */
  maxT: number
  /** Needs morphing on the next frame regardless of the mask. */
  stale: boolean
}

export interface LayoutParams {
  text: string
  align: 'left' | 'center' | 'right'
  /** Font size, a share of the canvas height. */
  fontSize: number
  lineHeight: number
  tracking: number
}

const LAYOUT_FEATURES = { liga: false, clig: false, dlig: false, calt: false, rlig: false }

const pairCache = new Map<string, GlyphPair>()
let cacheFonts = ''

function boxOf(glyphs: PolygonGlyph[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const g of glyphs)
    for (const c of g.contours)
      for (const p of c.points) {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y)
        maxY = Math.max(maxY, p.y)
      }
  return { minX, minY, maxX, maxY }
}

/** Tracks that leave every anchor where it is: a glyph that does not change. */
function stillTracks(glyph: PolygonGlyph): Track[] {
  return glyph.contours.map((c) => {
    const xs = Float64Array.from(c.points, (p) => p.x)
    const ys = Float64Array.from(c.points, (p) => p.y)
    return { clockwise: c.clockwise, sx: xs, sy: ys, tx: xs, ty: ys }
  })
}

/** A glyph of A and B's glyph for the same character, paired; cached. */
export function pairGlyphs(a: FontLike, b: FontLike, glyphA: Glyph, glyphB: Glyph | null): GlyphPair {
  const fonts = `${a.id}:${b.id}`
  if (fonts !== cacheFonts) {
    pairCache.clear()
    cacheFonts = fonts
  }
  const key = `${glyphA.id}:${glyphB?.id ?? -1}`
  const cached = pairCache.get(key)
  if (cached) return cached
  const polyA = glyphPolygon(glyphA, a.unitsPerEm)
  let pair: GlyphPair
  if (!glyphB) {
    pair = { tracks: stillTracks(polyA), ...boxOf([polyA]), morphs: false }
  } else {
    const k = a.unitsPerEm / b.unitsPerEm
    const dx = (glyphA.advanceWidth - glyphB.advanceWidth * k) / 2
    const polyB = placePolygon(glyphPolygon(glyphB, b.unitsPerEm), k, dx)
    const plan: MorphPlan | null = planMorph(polyA, polyB)
    pair = plan
      ? { tracks: plan.tracks, ...boxOf([polyA, polyB]), morphs: true }
      : { tracks: stillTracks(polyA), ...boxOf([polyA]), morphs: false }
  }
  pairCache.set(key, pair)
  return pair
}

/** Lays the text out on a canvas `width` × `height` and pairs every glyph. */
export function layoutScene(
  a: FontLike,
  b: FontLike,
  params: LayoutParams,
  width: number,
  height: number,
): PlacedGlyph[] {
  const size = params.fontSize * height
  const scale = size / a.unitsPerEm
  const lines = params.text.split(/\r?\n/)
  const advance = params.lineHeight * size
  const blockH = (lines.length - 1) * advance + (a.ascent - a.descent) * scale
  const firstBaseline = (height - blockH) / 2 + a.ascent * scale
  const margin = 0.06 * width
  const out: PlacedGlyph[] = []
  lines.forEach((line, li) => {
    if (!line) return
    const run = a.font.layout(line, LAYOUT_FEATURES)
    const spacing = params.tracking * size
    let lineW = 0
    run.positions.forEach((p, i) => (lineW += p.xAdvance * scale + (i < run.positions.length - 1 ? spacing : 0)))
    let x = params.align === 'left' ? margin : params.align === 'right' ? width - margin - lineW : (width - lineW) / 2
    const baseline = firstBaseline + li * advance
    run.glyphs.forEach((glyphA, i) => {
      const pos = run.positions[i]
      const cp = glyphA.codePoints[0]
      if (glyphA.path.commands.length > 0) {
        let glyphB: Glyph | null = cp !== undefined ? b.font.glyphForCodePoint(cp) : null
        if (glyphB && (glyphB.id === 0 || glyphB.path.commands.length === 0)) glyphB = null
        const pair = pairGlyphs(a, b, glyphA, glyphB)
        const gx = x + pos.xOffset * scale
        const gy = baseline - pos.yOffset * scale
        out.push({
          pair,
          scale,
          x: gx,
          y: gy,
          box: {
            x0: gx + pair.minX * scale,
            x1: gx + pair.maxX * scale,
            y0: gy - pair.maxY * scale,
            y1: gy - pair.minY * scale,
          },
          shape: pair.tracks.map((t) => new Float32Array(t.sx.length * 2)),
          maxT: -1,
          stale: true,
        })
      }
      x += pos.xAdvance * scale + spacing
    })
  })
  return out
}

/**
 * Moves every anchor of `g` to A + t·(B − A), t read at the anchor's A position by `tAt` (canvas pixels); with
 * `wholeGlyph`, one t for the glyph: the mean under its anchors.
 */
export function morphGlyph(g: PlacedGlyph, tAt: (x: number, y: number) => number, wholeGlyph: boolean): void {
  const { scale, x, y } = g
  let whole = 0
  if (wholeGlyph && g.pair.morphs) {
    let sum = 0
    let n = 0
    for (const t of g.pair.tracks)
      for (let i = 0; i < t.sx.length; i++) {
        sum += tAt(x + t.sx[i] * scale, y - t.sy[i] * scale)
        n++
      }
    whole = n ? sum / n : 0
  }
  let maxT = 0
  g.pair.tracks.forEach((t, ti) => {
    const out = g.shape[ti]
    for (let i = 0; i < t.sx.length; i++) {
      const ax = x + t.sx[i] * scale
      const ay = y - t.sy[i] * scale
      const k = g.pair.morphs ? (wholeGlyph ? whole : tAt(ax, ay)) : 0
      if (k > maxT) maxT = k
      out[2 * i] = ax + k * (t.tx[i] - t.sx[i]) * scale
      out[2 * i + 1] = ay - k * (t.ty[i] - t.sy[i]) * scale
    }
  })
  g.maxT = maxT
  g.stale = false
}
