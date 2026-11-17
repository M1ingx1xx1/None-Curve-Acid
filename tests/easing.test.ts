import { describe, expect, it } from 'vitest'
import { ease, EASE_NAMES } from '../src/acid/easing'

describe('easing curves', () => {
  it('lists Linear and Quad to Quint, each In, Out and InOut', () => {
    expect(EASE_NAMES).toHaveLength(13)
  })

  it('runs from 0 to 1 without going back', () => {
    for (const name of EASE_NAMES) {
      expect(ease(name, 0)).toBe(0)
      expect(ease(name, 1)).toBe(1)
      let last = 0
      for (let t = 0; t <= 1; t += 0.01) {
        const v = ease(name, t)
        expect(v).toBeGreaterThanOrEqual(last - 1e-12)
        last = v
      }
    }
  })

  it('In is slow at first, Out fast at first, InOut halfway at the middle', () => {
    for (const p of ['quad', 'cubic', 'quart', 'quint']) {
      expect(ease(`${p}In` as never, 0.3)).toBeLessThan(0.3)
      expect(ease(`${p}Out` as never, 0.3)).toBeGreaterThan(0.3)
      expect(ease(`${p}InOut` as never, 0.5)).toBeCloseTo(0.5)
    }
    expect(ease('quintIn', 0.5)).toBeLessThan(ease('quadIn', 0.5))
  })
})
