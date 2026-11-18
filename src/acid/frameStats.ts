// Frame timing over the last second: how often frames came (the real frame rate), the slowest gap, how long the page
// spent drawing each one (CPU only: the GPU runs after the call returns), and the frames that came late. Pure.

export interface FrameSummary {
  /** Frames in the last second. */
  fps: number
  /** The screen's refresh rate as the typical gap shows it (Hz). */
  refreshHz: number
  /** Mean and longest gap between frames (ms). */
  avgMs: number
  worstMs: number
  /** Mean and longest time spent drawing a frame (ms, CPU). */
  workAvgMs: number
  workMaxMs: number
  /** Gaps more than 1.5 refreshes long: frames the screen showed twice. */
  late: number
}

const WINDOW_MS = 1000

export class FrameStats {
  private times: number[] = []
  private work: number[] = []

  /** A frame drawn at `now` (ms) that took `workMs` to draw. */
  record(now: number, workMs: number): void {
    this.times.push(now)
    this.work.push(workMs)
    while (this.times.length > 2 && now - this.times[0] > WINDOW_MS) {
      this.times.shift()
      this.work.shift()
    }
  }

  summary(): FrameSummary | null {
    const t = this.times
    if (t.length < 3) return null
    const gaps: number[] = []
    for (let i = 1; i < t.length; i++) gaps.push(t[i] - t[i - 1])
    const sorted = [...gaps].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    const span = t[t.length - 1] - t[0]
    return {
      fps: span > 0 ? (gaps.length * 1000) / span : 0,
      refreshHz: median > 0 ? 1000 / median : 0,
      avgMs: span / gaps.length,
      worstMs: sorted[sorted.length - 1],
      workAvgMs: this.work.reduce((a, b) => a + b, 0) / this.work.length,
      workMaxMs: Math.max(...this.work),
      late: gaps.filter((g) => g > median * 1.5).length,
    }
  }
}
