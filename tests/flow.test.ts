import { describe, expect, it } from 'vitest'
import { strobeT } from '../src/acid/engine'
import { MaskField, type StampParams } from '../src/acid/mask'
import { densify } from '../src/font/outline'

const brush: StampParams = { radius: 40, hardness: 1, strength: 1, edgeNoise: 0, colorExtra: 0.5 }

describe('seep in', () => {
  it('rises to the stamped value over the rise time, then holds', () => {
    const mask = new MaskField(400, 400, 4)
    mask.riseColorMs = 200
    mask.riseMorphMs = 400
    mask.stamp(200, 200, brush)
    expect(mask.sample(mask.morph, 200, 200)).toBe(0)
    mask.step(100, 'hold', 1000, 'linear')
    expect(mask.sample(mask.color, 200, 200)).toBeCloseTo(0.5, 5)
    expect(mask.sample(mask.morph, 200, 200)).toBeCloseTo(0.25, 5)
    for (let i = 0; i < 5; i++) mask.step(100, 'hold', 1000, 'linear')
    expect(mask.sample(mask.color, 200, 200)).toBe(1)
    expect(mask.sample(mask.morph, 200, 200)).toBe(1)
  })

  it('fades only after it has risen, and clear still empties it', () => {
    const mask = new MaskField(400, 400, 4)
    mask.riseColorMs = mask.riseMorphMs = 200
    mask.stamp(200, 200, brush)
    for (let i = 0; i < 2; i++) mask.step(100, 'fade', 1000, 'linear')
    expect(mask.sample(mask.morph, 200, 200)).toBe(1)
    mask.step(500, 'fade', 1000, 'linear')
    expect(mask.sample(mask.morph, 200, 200)).toBeCloseTo(0.5, 5)
    mask.clear()
    expect(mask.sample(mask.morph, 200, 200)).toBe(0)
    expect(mask.takeDirty()).not.toBeNull()
  })
})

describe('shape warp and density', () => {
  it('stay within 0–1 and change the outline', () => {
    const plain = new MaskField(400, 400, 4)
    const warped = new MaskField(400, 400, 4)
    plain.stamp(200, 200, brush)
    warped.stamp(200, 200, { ...brush, shapeWarp: 1, density: 1 })
    let differs = 0
    for (let i = 0; i < warped.morph.length; i++) {
      expect(warped.morph[i]).toBeGreaterThanOrEqual(0)
      expect(warped.morph[i]).toBeLessThanOrEqual(1)
      if (Math.abs(warped.morph[i] - plain.morph[i]) > 0.1) differs++
    }
    expect(differs).toBeGreaterThan(20)
  })
})

describe('densify', () => {
  it('keeps every anchor and adds some on long sides only', () => {
    const square = {
      contours: [
        {
          clockwise: false,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 10 },
            { x: 0, y: 10 },
          ],
        },
      ],
    }
    const out = densify(square, 25).contours[0].points
    for (const p of square.contours[0].points) expect(out).toContainEqual(p)
    expect(out).toHaveLength(4 + 3 + 3)
    expect(densify(square, 0)).toBe(square)
  })
})

describe('strobeT', () => {
  it('stays in 0–1, leaves 0 alone, and holds for a period', () => {
    for (let g = 0; g < 50; g++) {
      const t = strobeT(0.6, 1, g, 3)
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThanOrEqual(1)
      expect(strobeT(0.6, 1, g, 3)).toBe(t)
      expect(strobeT(0, 1, g, 3)).toBe(0)
      expect(strobeT(0.6, 0, g, 3)).toBe(0.6)
    }
  })
})
