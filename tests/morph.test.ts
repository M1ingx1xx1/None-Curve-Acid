import * as fontkit from 'fontkit'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { morphAmount } from '../src/acid/brush'
import { layoutScene, morphGlyph, type FontLike, type GlyphPair, type PlacedGlyph } from '../src/acid/scene'
import { glyphPolygon, placePolygon, signedArea } from '../src/font/outline'
import { planMorph } from '../src/morph/pair'
import type { PolygonGlyph } from '../src/morph/types'

const poly = (pts: [number, number][]): PolygonGlyph => {
  const points = pts.map(([x, y]) => ({ x, y }))
  return { contours: [{ points, clockwise: signedArea(points) < 0 }] }
}
/** A square, 4 anchors. */
const square = poly([
  [0, 0],
  [100, 0],
  [100, 100],
  [0, 100],
])
/** An octagon around the same centre, 8 anchors: anchor counts differ. */
const octagon = poly(
  Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2
    return [50 + 60 * Math.cos(a), 50 + 60 * Math.sin(a)] as [number, number]
  }),
)

function placed(a: PolygonGlyph, b: PolygonGlyph): PlacedGlyph {
  const plan = planMorph(a, b)!
  const pair: GlyphPair = { tracks: plan.tracks, minX: -20, minY: -20, maxX: 120, maxY: 120, morphs: true }
  return {
    pair,
    scale: 1,
    x: 0,
    y: 0,
    box: { x0: -20, y0: -120, x1: 120, y1: 20 },
    shape: plan.tracks.map((t) => new Float32Array(t.sx.length * 2)),
    maxT: -1,
    stale: true,
  }
}

/** The drawn shape back in font units (canvas y = −font y here). */
function shapeOf(g: PlacedGlyph): { x: number; y: number }[][] {
  return g.shape.map((c) => Array.from({ length: c.length / 2 }, (_, i) => ({ x: c[2 * i], y: -c[2 * i + 1] })))
}
const area = (g: PlacedGlyph) => shapeOf(g).reduce((s, c) => s + signedArea(c), 0)

describe('per-anchor interpolation', () => {
  it('pairs outlines whose anchor counts differ, ending exactly on A and on B', () => {
    const g = placed(square, octagon)
    const n = g.pair.tracks.reduce((s, t) => s + t.sx.length, 0)
    expect(n).toBeGreaterThanOrEqual(8)
    morphGlyph(g, () => 0, false)
    expect(area(g)).toBeCloseTo(signedArea(square.contours[0].points), 2)
    morphGlyph(g, () => 1, false)
    expect(area(g)).toBeCloseTo(signedArea(octagon.contours[0].points), 2)
  })

  it('t = 0.5 is the average of A and B, anchor by anchor', () => {
    const g = placed(square, octagon)
    morphGlyph(g, () => 0.5, false)
    const mid = shapeOf(g)
    g.pair.tracks.forEach((t, ti) =>
      mid[ti].forEach((p, i) => {
        expect(p.x).toBeCloseTo((t.sx[i] + t.tx[i]) / 2, 4)
        expect(p.y).toBeCloseTo((t.sy[i] + t.ty[i]) / 2, 4)
      }),
    )
  })

  it('max morph 0.5 stops at the average shape', () => {
    const g = placed(square, octagon)
    const shaping = { band: 1, maxMorph: 0.5, morphEase: 'linear' as const }
    morphGlyph(g, () => morphAmount(1, shaping), false)
    expect(g.maxT).toBe(0.5)
    const half = shapeOf(g)
    g.pair.tracks.forEach((t, ti) => half[ti].forEach((p, i) => expect(p.x).toBeCloseTo((t.sx[i] + t.tx[i]) / 2, 4)))
  })

  it('moves only the half the brush covers', () => {
    const g = placed(square, octagon)
    // The brush covers the left half (canvas x < 50) only.
    morphGlyph(g, (x) => (x < 50 ? 1 : 0), false)
    const out = shapeOf(g)
    g.pair.tracks.forEach((t, ti) =>
      out[ti].forEach((p, i) => {
        const target = t.sx[i] < 50 ? { x: t.tx[i], y: t.ty[i] } : { x: t.sx[i], y: t.sy[i] }
        expect(p.x).toBeCloseTo(target.x, 4)
        expect(p.y).toBeCloseTo(target.y, 4)
      }),
    )
  })

  it('whole-glyph mode gives every anchor the same t', () => {
    const g = placed(square, octagon)
    morphGlyph(g, (x) => (x < 50 ? 1 : 0), true)
    const out = shapeOf(g)
    const ts = g.pair.tracks.flatMap((t, ti) =>
      out[ti].map((p, i) => {
        const dx = t.tx[i] - t.sx[i]
        const dy = t.ty[i] - t.sy[i]
        const d2 = dx * dx + dy * dy
        return d2 > 1 ? ((p.x - t.sx[i]) * dx + (p.y - t.sy[i]) * dy) / d2 : null
      }),
    )
    const known = ts.filter((v): v is number => v !== null)
    for (const v of known) expect(v).toBeCloseTo(known[0], 4)
    expect(known[0]).toBeGreaterThan(0)
    expect(known[0]).toBeLessThan(1)
  })
})

describe('real font pair (Roboto → STIX Two Text)', () => {
  const load = (file: string, id: number): FontLike => {
    const font = fontkit.create(readFileSync(`public/fonts/${file}`)) as fontkit.Font
    return { id, font, unitsPerEm: font.unitsPerEm, ascent: font.ascent, descent: font.descent }
  }
  const a = load('Roboto.ttf', 1)
  const b = load('STIXTwoText.ttf', 2)
  const glyphs = layoutScene(
    a,
    b,
    { text: 'ADO6ag\nRe&?', align: 'center', fontSize: 0.2, lineHeight: 1.1, tracking: 0 },
    1000,
    1000,
  )

  it('lays out every inked glyph, paired with B', () => {
    expect(glyphs).toHaveLength(10)
    expect(glyphs.every((g) => g.pair.morphs)).toBe(true)
  })

  it('draws A at t = 0 and B at t = 1, with different anchor counts on each side', () => {
    for (const g of glyphs) {
      const k = g.scale
      morphGlyph(g, () => 0, false)
      const atA = area(g) / (k * k)
      morphGlyph(g, () => 1, false)
      const atB = area(g) / (k * k)
      // Every contour of A or B is drawn; contours that grow or shrink are flat at their other end.
      const ownA = g.pair.tracks.reduce((s, t) => s + signedArea(Array.from(t.sx, (x, i) => ({ x, y: t.sy[i] }))), 0)
      const ownB = g.pair.tracks.reduce((s, t) => s + signedArea(Array.from(t.tx, (x, i) => ({ x, y: t.ty[i] }))), 0)
      expect(atA).toBeCloseTo(ownA, 0)
      expect(atB).toBeCloseTo(ownB, 0)
      expect(Math.abs(ownA - ownB)).toBeGreaterThan(0)
    }
  })

  it('fills exactly A at t = 0 and B at t = 1 (nonzero), counters formed by overlaps included', () => {
    // Roboto is variable and unmerged: 'D' and '6' form their counters from overlapping contours, so a counter of B
    // that grows must start as a point there, not as a contour round A's counter.
    const text = 'ADO6ag'
    const ga = a.font.layout(text, { liga: false }).glyphs
    for (let n = 0; n < 6; n++) {
      const g = glyphs[n]
      const k = a.unitsPerEm / b.unitsPerEm
      const glyphB = b.font.glyphForCodePoint(text.codePointAt(n)!)
      const polyA = glyphPolygon(ga[n], a.unitsPerEm).contours.map((c) => c.points)
      const polyB = placePolygon(
        glyphPolygon(glyphB, b.unitsPerEm),
        k,
        (ga[n].advanceWidth - glyphB.advanceWidth * k) / 2,
      ).contours.map((c) => c.points)
      for (const [t, own] of [
        [0, polyA],
        [1, polyB],
      ] as const) {
        morphGlyph(g, () => t, false)
        const drawn = shapeOf(g).map((c) => c.map((p) => ({ x: (p.x - g.x) / g.scale, y: (p.y + g.y) / g.scale })))
        let differ = 0
        for (let i = 0; i < 40; i++)
          for (let j = 0; j < 40; j++) {
            const x = g.pair.minX + ((i + 0.5) / 40) * (g.pair.maxX - g.pair.minX)
            const y = g.pair.minY + ((j + 0.5) / 40) * (g.pair.maxY - g.pair.minY)
            if ((winding(drawn, x, y) !== 0) !== (winding(own, x, y) !== 0)) differ++
          }
        // Points right on an edge may fall either way.
        expect(differ, `glyph ${text[n]} at t = ${t}`).toBeLessThanOrEqual(3)
      }
    }
  })
})

/** Nonzero winding number of closed polygons at (x, y). */
function winding(contours: { x: number; y: number }[][], x: number, y: number): number {
  let w = 0
  for (const c of contours)
    for (let i = 0; i < c.length; i++) {
      const p = c[i]
      const q = c[(i + 1) % c.length]
      if (p.y <= y) {
        if (q.y > y && (q.x - p.x) * (y - p.y) - (x - p.x) * (q.y - p.y) > 0) w++
      } else if (q.y <= y && (q.x - p.x) * (y - p.y) - (x - p.x) * (q.y - p.y) < 0) w--
    }
  return w
}
