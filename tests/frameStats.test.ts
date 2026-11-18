import { describe, expect, it } from 'vitest'
import { FrameStats } from '../src/acid/frameStats'

describe('FrameStats', () => {
  it('reads 60 fps and one late frame from the last second only', () => {
    const s = new FrameStats()
    let now = 0
    // An old stretch at 30 fps, then a second at 60 with one frame shown twice.
    for (let i = 0; i < 30; i++) s.record((now += 33.3), 20)
    for (let i = 0; i < 60; i++) s.record((now += i === 30 ? 33.3 : 16.7), 4)
    const r = s.summary()!
    expect(r.refreshHz).toBeCloseTo(60, 0)
    expect(r.late).toBe(1)
    expect(r.worstMs).toBeCloseTo(33.3, 1)
    expect(r.fps).toBeGreaterThan(55)
    expect(r.fps).toBeLessThan(61)
    expect(r.workMaxMs).toBe(4)
  })

  it('has nothing to say before a few frames', () => {
    const s = new FrameStats()
    s.record(0, 1)
    expect(s.summary()).toBeNull()
  })
})
