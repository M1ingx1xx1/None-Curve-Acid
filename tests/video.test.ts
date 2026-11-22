import { describe, expect, it } from 'vitest'
import { MAX_TICKS_PER_REFRESH, tickTime, ticksDue } from '../src/export/clock'

/** Plays the take's clock over screen refreshes (ms): the times of the ticks drawn, in order. */
function take(refreshes: number[], fps: number, max = MAX_TICKS_PER_REFRESH) {
  const drawn: number[] = []
  for (const t of refreshes) {
    const n = ticksDue(t, drawn.length, fps, max)
    for (let i = 0; i < n; i++) drawn.push(tickTime(drawn.length, fps))
  }
  return drawn
}

const refreshes = (hz: number, ms: number) =>
  Array.from({ length: Math.floor((ms * hz) / 1000) + 1 }, (_, i) => (i * 1000) / hz)

describe('recording clock', () => {
  it.each([30, 60, 90])('draws one distinct frame per tick at %i fps on a 60 Hz screen', (fps) => {
    const drawn = take(refreshes(60, 2000), fps)
    // Every tick up to the end has its own frame, at its own time: none repeated, none missing.
    expect(drawn.length).toBe(Math.floor((2000 * fps) / 1000) + 1)
    drawn.forEach((t, i) => expect(t).toBeCloseTo((i * 1000) / fps, 9))
    expect(new Set(drawn).size).toBe(drawn.length)
  })

  it('draws 90 fps on a 120 Hz screen too', () => {
    expect(take(refreshes(120, 1000), 90)).toHaveLength(91)
  })

  it('catches up a few ticks a refresh after a stall, without skipping any', () => {
    const drawn = take([0, 500, 520, 540, 560, 580, 600, 620, 640, 660, 680, 700], 90, 4)
    drawn.forEach((t, i) => expect(t).toBeCloseTo((i * 1000) / 90, 9))
    expect(drawn.length).toBe(1 + 4 * 11)
  })

  it('draws nothing before a tick is due', () => {
    expect(ticksDue(5, 1, 30)).toBe(0)
    expect(ticksDue(34, 1, 30)).toBe(1)
  })
})
