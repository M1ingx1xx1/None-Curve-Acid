// The polygon outline model the pairing works on (a subset of None-Curve src/geometry/types.ts).

export interface Point {
  x: number
  y: number
}

export interface PolygonContour {
  points: Point[]
  clockwise: boolean
}

export interface PolygonGlyph {
  contours: PolygonContour[]
}
