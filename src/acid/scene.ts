// The text on the canvas: laid out with font A (fontkit's shaping, so kerning applies), each glyph paired with the
// same character of each target font (B1, and B2 when there is one; a letter morphs towards one of them at a time), centred in A's advance at A's em size (never scaled up beyond that). The pairing
// (morph/pair.ts) is cached per glyph pair and only redone when the fonts or the text change; each frame only moves
// anchors (morphGlyph). Pure: no DOM.

import type { Font, Glyph } from 'fontkit'
import { densify, glyphPolygon, placePolygon } from '../font/outline'
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
  /** The pair drawn now (pairs[target]). */
  pair: GlyphPair
  /** One pair per target font (B1, B2); absent means `pair` is the only one. */
  pairs?: GlyphPair[]
  /** Which of `pairs` the letter is heading for. */
  target?: number
  /** The font size in canvas pixels. */
  size?: number
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
  /** 0–1: extra anchors on long sides (0 none). */
  anchorDensity?: number
}

const LAYOUT_FEATURES = { liga: false, clig: false, dlig: false, calt: false, rlig: false }

const pairCache = new Map<string, GlyphPair>()
let cacheFonts = ''
/** Pairs kept at most before the cache starts again (two targets, many sizes). */
const CACHE_LIMIT = 6000

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

/** How far (canvas pixels) a flattened curve may stray from the true one. */
export const CURVE_TOLERANCE_PX = 0.2

/**
 * The flattening tolerance in font units for glyphs drawn at `scale` (pixels per font unit), rounded down to a step of
 * √2 so a size slider does not pair the glyphs again on every move.
 */
export function curveTolerance(scale: number): number {
  const step = Math.ceil(2 * Math.log2(Math.max(1e-6, scale)))
  return CURVE_TOLERANCE_PX / 2 ** (step / 2)
}

/** The longest side (a share of the em) at anchor density `density`; 0 for no extra anchors. */
export function maxSideShare(density: number): number {
  return density > 0 ? 0.008 + 0.12 * (1 - Math.min(1, density)) : 0
}

/**
 * A glyph of A and B's glyph for the same character, paired; cached. `tolerance`: A's font units. `density`: extra
 * anchors on long sides of both (anchorDensity).
 */
export function pairGlyphs(
  a: FontLike,
  b: FontLike,
  glyphA: Glyph,
  glyphB: Glyph | null,
  tolerance: number,
  density = 0,
): GlyphPair {
  const fonts = `${a.id}`
  if (fonts !== cacheFonts || pairCache.size > CACHE_LIMIT) {
    pairCache.clear()
    cacheFonts = fonts
  }
  const key = `${b.id}:${glyphA.id}:${glyphB?.id ?? -1}:${tolerance}:${density}`
  const cached = pairCache.get(key)
  if (cached) return cached
  const maxSide = maxSideShare(density) * a.unitsPerEm
  const polyA = densify(glyphPolygon(glyphA, tolerance), maxSide)
  let pair: GlyphPair
  if (!glyphB) {
    pair = { tracks: stillTracks(polyA), ...boxOf([polyA]), morphs: false }
  } else {
    const k = a.unitsPerEm / b.unitsPerEm
    const dx = (glyphA.advanceWidth - glyphB.advanceWidth * k) / 2
    const polyB = densify(placePolygon(glyphPolygon(glyphB, tolerance / k), k, dx), maxSide)
    const plan: MorphPlan | null = planMorph(polyA, polyB)
    pair = plan
      ? { tracks: plan.tracks, ...boxOf([polyA, polyB]), morphs: true }
      : { tracks: stillTracks(polyA), ...boxOf([polyA]), morphs: false }
  }
  pairCache.set(key, pair)
  return pair
}

/** Lays the text out on a canvas `width` × `height` and pairs every glyph with each target font in `b`. */
export function layoutScene(
  a: FontLike,
  b: FontLike | readonly FontLike[],
  params: LayoutParams,
  width: number,
  height: number,
): PlacedGlyph[] {
  const targets = Array.isArray(b) ? (b as readonly FontLike[]) : [b as FontLike]
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
        const pairs = targets.map((t) => {
          let glyphB: Glyph | null = cp !== undefined ? t.font.glyphForCodePoint(cp) : null
          if (glyphB && (glyphB.id === 0 || glyphB.path.commands.length === 0)) glyphB = null
          return pairGlyphs(a, t, glyphA, glyphB, curveTolerance(scale), params.anchorDensity ?? 0)
        })
        const pair = pairs[0]
        const gx = x + pos.xOffset * scale
        const gy = baseline - pos.yOffset * scale
        out.push({
          pair,
          pairs,
          target: 0,
          size,
          scale,
          x: gx,
          y: gy,
          box: {
            x0: gx + Math.min(...pairs.map((q) => q.minX)) * scale,
            x1: gx + Math.max(...pairs.map((q) => q.maxX)) * scale,
            y0: gy - Math.max(...pairs.map((q) => q.maxY)) * scale,
            y1: gy - Math.min(...pairs.map((q) => q.minY)) * scale,
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

/** Points `g` at target `index` of its pairs (a no-op when it already is, or has no such pair). */
export function setTarget(g: PlacedGlyph, index: number): void {
  const pairs = g.pairs
  if (!pairs || !pairs[index] || (g.target ?? 0) === index) return
  g.target = index
  g.pair = pairs[index]
  g.shape = g.pair.tracks.map((t) => new Float32Array(t.sx.length * 2))
  g.stale = true
}

/** Moves an anchor at (x, y) with morph amount t by (dx, dy) canvas pixels on top of the morph. */
export type Displace = (x: number, y: number, t: number) => readonly [number, number]

/**
 * Moves every anchor of `g` to A + t·(B − A), t read at the anchor's A position by `tAt` (canvas pixels); with
 * `wholeGlyph`, one t for the glyph: the mean under its anchors. `displace` moves anchors further (Glitch).
 */
export function morphGlyph(
  g: PlacedGlyph,
  tAt: (x: number, y: number) => number,
  wholeGlyph: boolean,
  displace?: Displace,
): void {
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
      if (displace && k > 0 && k < 1) {
        const [dx, dy] = displace(ax, ay, k)
        out[2 * i] += dx
        out[2 * i + 1] += dy
      }
    }
  })
  g.maxT = maxT
  g.stale = false
}
