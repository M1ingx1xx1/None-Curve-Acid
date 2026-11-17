// The brush's motion: the spring that Follow and the auto brush trail with (Spring2, copied from None-Curve
// src/acid/motion.ts), and the auto brush's organic wandering path. Pure: no DOM.

/** A point in canvas shares (x right, y down). */
export interface Point2 {
  x: number
  y: number
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0)

/**
 * A point following a target on a damped spring: `looseness` 0 is stiff (close behind, no overshoot), 1 loose (lags
 * and swings past). Stepped with the frame's time.
 */
export class Spring2 {
  x: number
  y: number
  private vx = 0
  private vy = 0
  constructor(at: Point2) {
    this.x = at.x
    this.y = at.y
  }
  /** Jumps to `at` and stops. */
  reset(at: Point2) {
    this.x = at.x
    this.y = at.y
    this.vx = 0
    this.vy = 0
  }
  step(target: Point2, dtMs: number, looseness: number): Point2 {
    const l = clamp01(looseness)
    const stiffness = 220 - 190 * l
    // Critically damped when stiff, about a third of that when loose.
    const damping = 2 * Math.sqrt(stiffness) * (1 - 0.65 * l)
    // Small steps, so a long frame (a busy tab) cannot make the spring blow up.
    let left = Math.min(Math.max(0, dtMs), 250) / 1000
    while (left > 0) {
      const h = Math.min(left, 1 / 120)
      this.vx += (stiffness * (target.x - this.x) - damping * this.vx) * h
      this.vy += (stiffness * (target.y - this.y) - damping * this.vy) * h
      this.x += this.vx * h
      this.y += this.vy * h
      left -= h
    }
    return { x: this.x, y: this.y }
  }
}

/**
 * The auto brush after walking `distance` (canvas heights) on a canvas `aspect` (width / height) wide: from the start
 * (x, y canvas shares) in a straight line at `angle` degrees (0 right, 90 up) until it is `margin` (canvas heights)
 * past the far edge, then back to the start, and again. Where it is depends only on the distance, so it loops exactly.
 */
export function sweepPath(
  x: number,
  y: number,
  angle: number,
  distance: number,
  aspect: number,
  margin: number,
): Point2 {
  const a = ((Number.isFinite(angle) ? angle : 0) * Math.PI) / 180
  // Canvas heights, y down.
  const dx = Math.cos(a)
  const dy = -Math.sin(a)
  const sx = x * aspect
  const sy = y
  // How far the line runs from the start before it leaves the canvas grown by `margin`.
  const reach = (s: number, d: number, lo: number, hi: number) =>
    d > 1e-9 ? (hi - s) / d : d < -1e-9 ? (lo - s) / d : Infinity
  const length = Math.max(0, Math.min(reach(sx, dx, -margin, aspect + margin), reach(sy, dy, -margin, 1 + margin)))
  if (!(length > 0) || !Number.isFinite(distance)) return { x, y }
  const m = ((distance % (2 * length)) + 2 * length) % (2 * length)
  const t = m <= length ? m : 2 * length - m
  return { x: (sx + dx * t) / aspect, y: sy + dy * t }
}
