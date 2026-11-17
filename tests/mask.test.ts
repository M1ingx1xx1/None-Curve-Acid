import { describe, expect, it } from 'vitest'
import { MaskField, type StampParams } from '../src/acid/mask'

const brush: StampParams = { radius: 40, hardness: 1, strength: 1, edgeNoise: 0, colorExtra: 0.5 }

function stamped(): MaskField {
  const mask = new MaskField(400, 400, 4)
  mask.stamp(200, 200, brush)
  return mask
}

describe('mask', () => {
  it('stamps 1 at the centre and 0 far away; colour reaches further than the morph', () => {
    const mask = stamped()
    expect(mask.sample(mask.morph, 200, 200)).toBeCloseTo(1)
    expect(mask.sample(mask.morph, 20, 20)).toBe(0)
    expect(mask.sample(mask.morph, 252, 200)).toBe(0)
    expect(mask.sample(mask.color, 252, 200)).toBeGreaterThan(0.9)
  })

  it('reports where it changed', () => {
    const mask = stamped()
    const dirty = mask.takeDirty()!
    expect(dirty.x0).toBeLessThanOrEqual(160)
    expect(dirty.x1).toBeGreaterThanOrEqual(240)
    expect(mask.takeDirty()).toBeNull()
  })

  it('holds strokes in hold mode', () => {
    const mask = stamped()
    mask.step(10_000, 'hold', 1000, 'linear')
    expect(mask.sample(mask.morph, 200, 200)).toBeCloseTo(1)
  })

  it('decays along the fade curve over the fade time', () => {
    const mask = stamped()
    mask.step(500, 'fade', 1000, 'linear')
    expect(mask.sample(mask.morph, 200, 200)).toBeCloseTo(0.5)
    mask.step(250, 'fade', 1000, 'linear')
    expect(mask.sample(mask.morph, 200, 200)).toBeCloseTo(0.25)
    mask.step(250, 'fade', 1000, 'linear')
    expect(mask.sample(mask.morph, 200, 200)).toBe(0)
    expect(mask.sample(mask.color, 200, 200)).toBe(0)
  })

  it('fades faster early with an Out curve', () => {
    const mask = stamped()
    mask.step(500, 'fade', 1000, 'quadOut')
    expect(mask.sample(mask.morph, 200, 200)).toBeCloseTo(0.25)
  })

  it('restarts the fade where a cell is stamped again', () => {
    const mask = stamped()
    mask.step(900, 'fade', 1000, 'linear')
    mask.stamp(200, 200, brush)
    mask.step(500, 'fade', 1000, 'linear')
    expect(mask.sample(mask.morph, 200, 200)).toBeCloseTo(0.5)
  })

  it('keeps a fast stroke unbroken', () => {
    const mask = new MaskField(400, 400, 4)
    mask.stroke(50, 200, 350, 200, brush)
    for (let x = 50; x <= 350; x += 10) expect(mask.sample(mask.morph, x, 200)).toBeGreaterThan(0.99)
  })

  it('clears', () => {
    const mask = stamped()
    mask.clear()
    expect(mask.morph.every((v) => v === 0)).toBe(true)
  })
})
