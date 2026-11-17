import { describe, expect, it } from 'vitest'
import { sweepPath } from '../src/acid/motion'

const near = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x)
  expect(p.y).toBeCloseTo(y)
}

describe('auto sweep path', () => {
  it('goes from the start to the far edge and back, at 0° left to right', () => {
    near(sweepPath(0, 0.5, 0, 0, 1, 0), 0, 0.5)
    near(sweepPath(0, 0.5, 0, 0.5, 1, 0), 0.5, 0.5)
    near(sweepPath(0, 0.5, 0, 1, 1, 0), 1, 0.5)
    near(sweepPath(0, 0.5, 0, 1.25, 1, 0), 0.75, 0.5)
    near(sweepPath(0, 0.5, 0, 2, 1, 0), 0, 0.5)
    near(sweepPath(0, 0.5, 0, 2.5, 1, 0), 0.5, 0.5)
  })

  it('follows the angle: 180° right to left, 90° bottom to top, 45° up and right', () => {
    near(sweepPath(1, 0.5, 180, 0.5, 1, 0), 0.5, 0.5)
    near(sweepPath(0.5, 1, 90, 1, 1, 0), 0.5, 0)
    near(sweepPath(0, 1, 45, Math.SQRT2, 1, 0), 1, 0)
  })

  it('runs `margin` past the edge, in canvas heights on a wide canvas', () => {
    // 2:1 canvas: one canvas height is half its width.
    near(sweepPath(0, 0.5, 0, 2.25, 2, 0.25), 1.125, 0.5)
    near(sweepPath(0, 0.5, 0, 2.5, 2, 0.25), 1, 0.5)
  })

  it('stays put when the start is already past the edge in that direction', () => {
    near(sweepPath(1, 0.5, 0, 3, 1, 0), 1, 0.5)
  })
})
