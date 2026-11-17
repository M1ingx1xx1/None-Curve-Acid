import { describe, expect, it } from 'vitest'
import { brushFalloff, brushReach, falloffWidth, morphAmount } from '../src/acid/brush'

/** Width (in radii) of the ring where the falloff is between 5% and 95%. */
function bandWidth(hardness: number): number {
  let inner = 0
  let outer = 0
  for (let u = 0; u <= 3; u += 0.001) {
    const v = brushFalloff(u, hardness)
    if (v >= 0.95) inner = u
    if (v > 0.05) outer = u
  }
  return outer - inner
}

describe('brush hardness curve', () => {
  it('is 1 at the centre and 0 past its reach, for every hardness', () => {
    for (const h of [0, 0.25, 0.5, 0.75, 1]) {
      expect(brushFalloff(0, h)).toBe(1)
      expect(brushFalloff(brushReach(h) + 1e-6, h)).toBe(0)
    }
  })

  it('never rises going outwards', () => {
    for (const h of [0, 0.3, 0.7, 1]) {
      let last = 1
      for (let u = 0; u <= 2.5; u += 0.01) {
        const v = brushFalloff(u, h)
        expect(v).toBeLessThanOrEqual(last + 1e-12)
        last = v
      }
    }
  })

  it('narrows the in-between ring as hardness goes from 0 to 1', () => {
    const widths = [0, 0.25, 0.5, 0.75, 1].map(bandWidth)
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThan(widths[i - 1])
    expect(widths[0]).toBeGreaterThan(1)
    expect(widths[4]).toBeLessThan(0.01)
  })

  it('is a near step at hardness 1 and wide at hardness 0', () => {
    expect(brushFalloff(0.99, 1)).toBeGreaterThan(0.99)
    expect(brushFalloff(1.01, 1)).toBeLessThan(0.01)
    expect(brushFalloff(0.5, 0)).toBeGreaterThan(0.5)
    expect(brushFalloff(0.5, 0)).toBeLessThan(1)
    expect(brushFalloff(1.5, 0)).toBeGreaterThan(0)
    expect(falloffWidth(0)).toBeGreaterThan(falloffWidth(1))
  })
})

describe('morph amount', () => {
  const base = { band: 1, maxMorph: 1, morphEase: 'linear' as const }

  it('follows the mask with the full band and a linear curve', () => {
    for (const m of [0, 0.25, 0.5, 1]) expect(morphAmount(m, base)).toBeCloseTo(m)
  })

  it('caps at max morph: 0.5 reaches at most halfway', () => {
    expect(morphAmount(1, { ...base, maxMorph: 0.5 })).toBe(0.5)
    expect(morphAmount(0.4, { ...base, maxMorph: 0.5 })).toBeCloseTo(0.2)
  })

  it('switches at half strength with a band of 0', () => {
    const s = { ...base, band: 0 }
    expect(morphAmount(0.49, s)).toBe(0)
    expect(morphAmount(0.51, s)).toBe(1)
  })

  it('applies the morph curve', () => {
    expect(morphAmount(0.5, { ...base, morphEase: 'quadIn' })).toBeCloseTo(0.25)
    expect(morphAmount(0.5, { ...base, morphEase: 'quadOut' })).toBeCloseTo(0.75)
  })
})
