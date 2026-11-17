import { describe, expect, it } from 'vitest'
import { nextSample } from '../src/export/videoEncode'

/** Plays the recorder's clock over frame times (ms) and returns the samples' ticks and the end tick. */
function take(frameTimes: number[], fps: number, stopMs: number) {
  let next = 0
  const ticks: number[] = []
  for (const t of frameTimes) {
    const plan = nextSample(t, next, fps)
    if (!plan) continue
    ticks.push(plan.tick)
    next = plan.after
  }
  return { ticks, end: Math.max(1, Math.round((stopMs * fps) / 1000)) }
}

describe('recording clock', () => {
  it('takes one sample per tick at 60 Hz drawing into a 30 fps file', () => {
    const frames = Array.from({ length: 120 }, (_, i) => i * (1000 / 60))
    const { ticks, end } = take(frames, 30, 2000)
    expect(ticks).toEqual(Array.from({ length: 60 }, (_, i) => i))
    expect(end / 30).toBe(2)
  })

  it('starts each sample on the tick it was drawn at', () => {
    expect(take([0, 500], 30, 1000).ticks).toEqual([0, 15])
    expect(take([40, 80], 30, 1000).ticks).toEqual([0, 2])
  })

  it('covers every tick when drawing is slower than the file, so the length still matches the take', () => {
    const frames = Array.from({ length: 21 }, (_, i) => i * 100) // 10 fps drawing
    const { ticks, end } = take(frames, 30, 2000)
    // Each sample lasts until the next one starts: together they cover 0 to the end without gaps.
    const durations = ticks.map((t, i) => (i + 1 < ticks.length ? ticks[i + 1] : end) - t)
    expect(durations.reduce((s, d) => s + d, 0)).toBe(end)
    expect(end / 30).toBeCloseTo(2)
  })
})
