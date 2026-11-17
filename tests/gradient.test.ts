import { describe, expect, it } from 'vitest'
import { gradientAt, gradientPosition, reverseStops, slantDirection } from '../src/acid/gradient'

describe('gradient direction', () => {
  it('runs left to right at 0°, bottom to top at 90°, right to left at 180°', () => {
    expect(slantDirection(0)).toEqual({ x: 1, y: 0 })
    expect(slantDirection(90)).toEqual({ x: 0, y: -1 })
    expect(slantDirection(180)).toEqual({ x: -1, y: 0 })
    const d = slantDirection(45)
    expect(d.x).toBeCloseTo(Math.SQRT1_2)
    expect(d.y).toBeCloseTo(-Math.SQRT1_2)
  })

  it('places the canvas edges at the ends of the gradient', () => {
    expect(gradientPosition(0, 0.5, 1, 0, 0)).toBeCloseTo(0)
    expect(gradientPosition(1, 0.5, 1, 0, 0)).toBeCloseTo(1)
    expect(gradientPosition(0.5, 1, 1, 90, 0)).toBeCloseTo(0)
    expect(gradientPosition(0.5, 0, 1, 90, 0)).toBeCloseTo(1)
    expect(gradientPosition(0, 1, 1, 45, 0)).toBeCloseTo(0)
    expect(gradientPosition(1, 0, 1, 45, 0)).toBeCloseTo(1)
  })

  it('mirrors as it flows, so it never jumps', () => {
    expect(gradientPosition(1, 0.5, 1, 0, 0.5)).toBeCloseTo(0.5)
    expect(gradientPosition(0.5, 0.5, 1, 0, 1)).toBeCloseTo(0.5)
  })
})

describe('gradient stops', () => {
  const stops = [
    { color: '#000000', pos: 0 },
    { color: '#ffffff', pos: 0.25 },
    { color: '#ff0000', pos: 1 },
  ]

  it('reads colours between stops by their positions', () => {
    expect(gradientAt(stops, 0)).toEqual([0, 0, 0])
    expect(gradientAt(stops, 0.125)).toEqual([0.5, 0.5, 0.5])
    expect(gradientAt(stops, 0.25)).toEqual([1, 1, 1])
    expect(gradientAt(stops, 1)).toEqual([1, 0, 0])
  })

  it('reverses positions and order', () => {
    expect(reverseStops(stops)).toEqual([
      { color: '#ff0000', pos: 0 },
      { color: '#ffffff', pos: 0.75 },
      { color: '#000000', pos: 1 },
    ])
  })
})
