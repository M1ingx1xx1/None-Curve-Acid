import { readFileSync } from 'node:fs'
import * as fontkit from 'fontkit'
import { describe, expect, it } from 'vitest'
import { flashEnvelope } from '../src/acid/engine'
import { glitchHold, glitchOffset, trailStep, type GlitchParams } from '../src/acid/glitch'
import { layoutScene, morphGlyph, setTarget, type FontLike } from '../src/acid/scene'
import { DEFAULT_SETTINGS, sanitize } from '../src/state/settings'

const gp: GlitchParams = { amount: 1, time: 1.3, size: 200, glyph: 3, ox: 100, oy: 300 }

describe('glitch', () => {
  it('leaves A and B exactly as they are', () => {
    for (const [x, y] of [
      [80, 250],
      [140, 180],
      [60, 299],
    ]) {
      expect(glitchOffset(x, y, 0, gp)).toEqual([0, 0])
      expect(glitchOffset(x, y, 1, gp)).toEqual([0, 0])
    }
    expect(glitchHold(0, 1)).toBe(0)
    expect(glitchHold(1, 1)).toBe(1)
  })

  it('moves in-between shapes, some slices more than others (tears)', () => {
    const shifts = Array.from({ length: 40 }, (_, i) => glitchOffset(100, 300 - i * 6, 0.5, gp)[0])
    expect(Math.max(...shifts.map(Math.abs))).toBeGreaterThan(5)
    expect(new Set(shifts.map((v) => Math.round(v))).size).toBeGreaterThan(3)
    expect(glitchOffset(100, 250, 0.5, { ...gp, amount: 0 })).toEqual([0, 0])
  })

  it('drifts smoothly in time: no jump between frames at 90 fps', () => {
    for (let i = 0; i < 200; i++) {
      const t = i / 90
      const a = glitchOffset(90, 240, 0.5, { ...gp, time: t })
      const b = glitchOffset(90, 240, 0.5, { ...gp, time: t + 1 / 90 })
      expect(Math.abs(a[0] - b[0])).toBeLessThan(gp.size * 0.06)
    }
  })

  it('never jumps in time at any height (slices fixed to the glyph)', () => {
    const p = { ...gp, oy: 300 }
    const a = glitchOffset(100, 230.640043, 0.5, { ...p, time: 1.299999 })
    const b = glitchOffset(100, 230.640043, 0.5, { ...p, time: 1.300001 })
    expect(Math.abs(a[0] - b[0])).toBeLessThan(0.01)
    for (let y = 100; y < 320; y += 0.37)
      for (let t = 0; t < 3; t += 0.05) {
        const u = glitchOffset(100, y, 0.5, { ...p, time: t })
        const v = glitchOffset(100, y, 0.5, { ...p, time: t + 1e-4 })
        expect(Math.abs(u[0] - v[0]) + Math.abs(u[1] - v[1])).toBeLessThan(0.05)
      }
  })

  it('holds the shapes round the middle longer', () => {
    expect(glitchHold(0.3, 1)).toBeGreaterThan(0.3)
    expect(glitchHold(0.7, 1)).toBeLessThan(0.7)
    expect(glitchHold(0.3, 0)).toBeCloseTo(0.3, 9)
  })

  it('trail follows up at once and falls back slowly', () => {
    const out = new Float32Array(2)
    trailStep(out, Float32Array.from([1, 0.2]), 16, 1000)
    expect(Array.from(out)).toEqual([1, expect.closeTo(0.2, 6)])
    const live = trailStep(out, Float32Array.from([0, 0.2]), 500, 1000)
    expect(live).toBe(true)
    expect(out[0]).toBeCloseTo(Math.exp(-0.5), 5)
    for (let i = 0; i < 100; i++) trailStep(out, Float32Array.from([0, 0]), 500, 1000)
    expect(Array.from(out)).toEqual([0, 0])
  })
})

describe('exposure flash', () => {
  it('fires at full brightness on the beat and falls fast before the next', () => {
    expect(flashEnvelope(0, 4)).toBe(1)
    expect(flashEnvelope(250, 4)).toBeCloseTo(1, 9)
    expect(flashEnvelope(125, 4)).toBeLessThan(0.05)
    expect(flashEnvelope(30, 4)).toBeGreaterThan(flashEnvelope(60, 4))
    expect(flashEnvelope(100, 0)).toBe(0)
  })
})

describe('settings', () => {
  it('takes 90 fps and the new options, and keeps old files working', () => {
    expect(sanitize({ fps: 90 }).fps).toBe(90)
    expect(sanitize({ fps: 45 }).fps).toBe(DEFAULT_SETTINGS.fps)
    expect(sanitize({ strobeMode: 'flash', flashColor: 'f0f' })).toMatchObject({
      strobeMode: 'flash',
      flashColor: '#ff00ff',
    })
    expect(sanitize({ strobeMode: 'nope' }).strobeMode).toBe('shape')
    const old = sanitize({ strobe: true, strobeAmount: 0.3 })
    expect(old).toMatchObject({ strobe: true, strobeMode: 'shape', contour: false, glitch: false })
  })
})

/** Signed area of interleaved outlines (shoelace), summed. */
function area(shape: Float32Array[]): number {
  let sum = 0
  for (const c of shape) {
    const n = c.length / 2
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      sum += c[2 * i] * c[2 * j + 1] - c[2 * j] * c[2 * i + 1]
    }
  }
  return sum / 2
}

describe('two target fonts', () => {
  const load = (file: string, id: number): FontLike => {
    const font = fontkit.create(readFileSync(`public/fonts/${file}`)) as fontkit.Font
    return { id, font, unitsPerEm: font.unitsPerEm, ascent: font.ascent, descent: font.descent }
  }
  const a = load('Roboto.ttf', 11)
  const b1 = load('STIXTwoText.ttf', 12)
  const b2 = load('Space-Test.otf', 13)
  const glyphs = layoutScene(
    a,
    [b1, b2],
    { text: 'Ag', align: 'center', fontSize: 0.2, lineHeight: 1.1, tracking: 0 },
    1000,
    1000,
  )

  it('pairs every letter with both targets', () => {
    expect(glyphs).toHaveLength(2)
    for (const g of glyphs) expect(g.pairs).toHaveLength(2)
  })

  it('starts from the same A whichever target a letter takes, and ends on that target', () => {
    for (const g of glyphs) {
      const ends: number[] = []
      for (const i of [0, 1]) {
        setTarget(g, i)
        morphGlyph(g, () => 0, false)
        ends.push(area(g.shape))
        morphGlyph(g, () => 1, false)
        const tr = g.pairs![i].tracks
        expect(g.shape[0][0]).toBeCloseTo(g.x + tr[0].tx[0] * g.scale, 3)
      }
      // A drawn either way fills the same area (contours one side lacks are flat there, so add none).
      expect(ends[0]).toBeCloseTo(ends[1], 0)
    }
  })
})
