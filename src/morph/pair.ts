// Anchor pairing between a glyph of font A and the same character in font B, so every anchor has a partner on the
// other outline. Copied from None-Curve src/specimen/morph.ts (planMorph and its helpers), cut down to the straight
// trajectory with 'nearest' correspondence (trajectory.ts STRAIGHT): no Whorl mesh, no glideOutline, no plan data,
// no in-between settling. Pure: no React, no DOM.
//
// Contours: each contour of A is paired with one of B of the same direction, the closest pairs first. A contour left
// without a partner grows from (or sinks into) the other outline, or its centre.
//
// Anchors of a paired contour: both outlines get the anchors of both, so their counts never need to agree. With as many
// anchors on both and close to one another, anchor goes to anchor; otherwise each anchor of either contour is placed on
// the other at its closest point, kept in order round the contour. Every anchor added this way lies on the other
// outline's sides, so the shape at t = 0 is exactly A and at t = 1 exactly B.

import type { PolygonContour, PolygonGlyph } from './types'

export const MORPH_LIMITS = {
  /** Anchors of an in-between glyph at most; a glyph that would need more changes at once. */
  maxPoints: 12_000,
  /** Samples round a contour weighed for the best turn, and the turns tried before the finer search (fewer on small contours). */
  shiftSamples: 32,
  shiftSteps: 64,
  /** Anchor goes to anchor while none moves further than this share of the contour's size (half its box's diagonal). */
  directShare: 0.35,
  /** With more contours than this on either side, each contour is weighed against its `neighbours` nearest only. */
  manyContours: 48,
  neighbours: 4,
  /** Contours further apart than this many times their sizes added up, or with areas further apart than this ratio, are never paired. */
  reach: 0.5,
  areaRatio: 4,
  /** Paired contours whose centres lie closer than this share of the smaller's size are matched as they lie, not centred. */
  centreShare: 0.5,
  /**
   * A contour without a partner grows out of (or sinks into) the other outline, each anchor from (or to) its closest
   * point there, when those lie within this share of its size on average; otherwise out of (or into) its centre.
   */
  attachShare: 1,
  /** An attached end may enclose at most this share of the contour's own area (flatAt). */
  flatShare: 0.05,
} as const

interface Ring {
  xs: Float64Array
  ys: Float64Array
  /** u[i]: the share of the way round at anchor i; u[n] = 1. */
  u: Float64Array
  n: number
  length: number
  cx: number
  cy: number
  area: number
  /** Half the diagonal of the contour's box, and the box. */
  size: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Which way it winds: by its area, or by its flag when it has none. */
  clockwise: boolean
  contour: PolygonContour
}

function ringOf(contour: PolygonContour): Ring {
  const pts = contour.points
  const n = pts.length
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  const u = new Float64Array(n + 1)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i].x
    ys[i] = pts[i].y
    minX = Math.min(minX, xs[i])
    maxX = Math.max(maxX, xs[i])
    minY = Math.min(minY, ys[i])
    maxY = Math.max(maxY, ys[i])
  }
  let length = 0
  let twice = 0
  let ax = 0
  let ay = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    length += Math.hypot(xs[j] - xs[i], ys[j] - ys[i])
    u[i + 1] = length
    const cross = xs[i] * ys[j] - xs[j] * ys[i]
    twice += cross
    ax += (xs[i] + xs[j]) * cross
    ay += (ys[i] + ys[j]) * cross
  }
  if (length > 0) for (let i = 0; i <= n; i++) u[i] /= length
  u[n] = 1
  let cx: number
  let cy: number
  if (Math.abs(twice) > 1e-9 * Math.max(1, (maxX - minX) * (maxY - minY))) {
    cx = ax / (3 * twice)
    cy = ay / (3 * twice)
  } else {
    cx = n > 0 ? xs.reduce((s, x) => s + x, 0) / n : 0
    cy = n > 0 ? ys.reduce((s, y) => s + y, 0) / n : 0
  }
  const size = n > 0 ? Math.hypot(maxX - minX, maxY - minY) / 2 : 0
  const flat = Math.abs(twice) <= 1e-9 * Math.max(1, (maxX - minX) * (maxY - minY))
  const clockwise = flat ? contour.clockwise : twice < 0
  return { xs, ys, u, n, length, cx, cy, area: twice / 2, size, minX, minY, maxX, maxY, clockwise, contour }
}

/** The point the share `t` of the way round `r` (any real; whole turns wrap), into `out`. */
function pointAt(r: Ring, t: number, out: { x: number; y: number }) {
  let f = t - Math.floor(t)
  if (f >= 1) f = 0
  const { u, n } = r
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (u[mid] <= f) lo = mid
    else hi = mid - 1
  }
  const j = lo + 1 < n ? lo + 1 : 0
  const span = u[lo + 1] - u[lo]
  const w = span > 0 ? (f - u[lo]) / span : 0
  out.x = r.xs[lo] + (r.xs[j] - r.xs[lo]) * w
  out.y = r.ys[lo] + (r.ys[j] - r.ys[lo]) * w
}

/** The side of `r` that the share `t` (in [0, 1)) of the way round falls on. */
function sideAt(r: Ring, t: number): number {
  let lo = 0
  let hi = r.n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (r.u[mid] <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * Where on `b` the start of `a` lies best: the share s of the way round `b` such that a(t) and b(t + s) lie closest over
 * the whole contour: as they are while the two overlap (their centres closer than MORPH_LIMITS.centreShare of the
 * smaller's size), so that a spike or a cut that shifts a contour's centre does not shift the match; otherwise each
 * taken from its centre (a contour that moved as a whole, such as one of Dissolve's islands).
 */
function bestShift(a: Ring, b: Ring): number {
  const centred = Math.hypot(a.cx - b.cx, a.cy - b.cy) > MORPH_LIMITS.centreShare * Math.min(a.size, b.size)
  const acx = centred ? a.cx : 0
  const acy = centred ? a.cy : 0
  const bcx = centred ? b.cx : 0
  const bcy = centred ? b.cy : 0
  // Small contours (Dissolve's islands) need fewer samples and turns: about two per anchor.
  const anchors = Math.max(a.n, b.n)
  const k = Math.min(MORPH_LIMITS.shiftSamples, Math.max(8, anchors))
  const ax = new Float64Array(k)
  const ay = new Float64Array(k)
  const p = { x: 0, y: 0 }
  for (let i = 0; i < k; i++) {
    pointAt(a, i / k, p)
    ax[i] = p.x - acx
    ay[i] = p.y - acy
  }
  const cost = (s: number) => {
    let sum = 0
    for (let i = 0; i < k; i++) {
      pointAt(b, i / k + s, p)
      const dx = p.x - bcx - ax[i]
      const dy = p.y - bcy - ay[i]
      sum += dx * dx + dy * dy
    }
    return sum
  }
  const steps = Math.min(MORPH_LIMITS.shiftSteps, Math.max(16, 2 * anchors))
  let best = 0
  let bestCost = cost(0)
  for (let i = 1; i < steps; i++) {
    const c = cost(i / steps)
    if (c < bestCost) {
      bestCost = c
      best = i / steps
    }
  }
  for (let step = 1 / (2 * steps); step > 1 / (64 * steps); step /= 2) {
    for (const s of [best - step, best + step]) {
      const c = cost(s)
      if (c < bestCost) {
        bestCost = c
        best = s
      }
    }
  }
  return best - Math.floor(best)
}

/**
 * Where the points (xs, ys), in order round their own contour (`shares` of the way round it, from 0 up to 1), belong on
 * `r`, kept in order round it from `start` to `start` + 1: each at its closest point of `r`, as long as those follow one
 * another round `r` (the longest run of them that does); the rest are spread between their neighbours in that run by
 * their own shares. So features only one contour has (a spike, a notch) are skipped over rather than dragging their
 * neighbours along, and no stretch of either contour gathers into one point unless it lies there.
 */
function inOrder(r: Ring, xs: Float64Array, ys: Float64Array, shares: Float64Array, start: number): Float64Array {
  const n = shares.length
  const out = { d: 0 }
  const at = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    let v = closestOn(r, xs[k], ys[k], out) + Math.floor(start)
    if (v < start) v += 1
    if (v >= start + 1) v -= 1
    at[k] = v
  }
  // The longest run that keeps its order (patience sorting, non-decreasing).
  const tails: number[] = []
  const previous = new Int32Array(n).fill(-1)
  for (let k = 0; k < n; k++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (at[tails[mid]] <= at[k]) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) previous[k] = tails[lo - 1]
    tails[lo] = k
  }
  const inRun = new Uint8Array(n)
  for (let k = tails.length > 0 ? tails[tails.length - 1] : -1; k >= 0; k = previous[k]) inRun[k] = 1
  const result = new Float64Array(n)
  // Between the run's points (and the ends: share 0 at `start`, share 1 at `start` + 1), by share.
  let lastShare = 0
  let lastV = start
  let k = 0
  while (k < n) {
    let next = k
    while (next < n && !inRun[next]) next++
    const nextShare = next < n ? shares[next] : 1
    const nextV = next < n ? at[next] : start + 1
    for (let m = k; m < next; m++) {
      const w = nextShare > lastShare ? (shares[m] - lastShare) / (nextShare - lastShare) : 0
      result[m] = lastV + (nextV - lastV) * Math.min(1, Math.max(0, w))
    }
    if (next < n) {
      result[next] = nextV
      lastShare = nextShare
      lastV = nextV
    }
    k = next + 1
  }
  return result
}

/** One contour's anchors on their way, from (sx, sy) on A to (tx, ty) on B. */
export interface Track {
  clockwise: boolean
  sx: Float64Array
  sy: Float64Array
  tx: Float64Array
  ty: Float64Array
}

export interface MorphPlan {
  tracks: Track[]
  /** Anchors of the in-between glyph. */
  points: number
}

/** Pairs listed as plain arrays while they are built. */
class Pairs {
  sx: number[] = []
  sy: number[] = []
  tx: number[] = []
  ty: number[] = []
  kept: number[] = []
  base: number[] = []
  /** `atEnd`: the anchor's base is its end (see Trajectory.path). */
  push(sx: number, sy: number, tx: number, ty: number, kept: boolean, atEnd: boolean) {
    const n = this.sx.length
    // The same pair twice in a row (an anchor both outlines share) is drawn once.
    if (n > 0 && this.sx[n - 1] === sx && this.sy[n - 1] === sy && this.tx[n - 1] === tx && this.ty[n - 1] === ty) {
      if (kept) this.kept[n - 1] = 1
      return
    }
    this.sx.push(sx)
    this.sy.push(sy)
    this.tx.push(tx)
    this.ty.push(ty)
    this.kept.push(kept ? 1 : 0)
    this.base.push(atEnd ? 1 : 0)
  }
  track(clockwise: boolean): Track {
    return {
      clockwise,
      sx: Float64Array.from(this.sx),
      sy: Float64Array.from(this.sy),
      tx: Float64Array.from(this.tx),
      ty: Float64Array.from(this.ty),
    }
  }
}

function sameContour(a: PolygonContour, b: PolygonContour): boolean {
  if (a === b) return true
  if (a.points.length !== b.points.length || a.clockwise !== b.clockwise) return false
  for (let i = 0; i < a.points.length; i++)
    if (a.points[i].x !== b.points[i].x || a.points[i].y !== b.points[i].y) return false
  return true
}

/**
 * The point the share `t` of the way round `flat` puts on `ring` (into `out`): the same side, the same share along it.
 * `flat` is `ring` in the space the anchors are paired in (Trajectory.straighten), with the same anchors.
 */
function pointOn(ring: Ring, flat: Ring, t: number, out: { x: number; y: number }) {
  if (ring === flat) return pointAt(ring, t, out)
  let f = t - Math.floor(t)
  if (f >= 1) f = 0
  const e = sideAt(flat, f)
  const j = e + 1 < ring.n ? e + 1 : 0
  const span = flat.u[e + 1] - flat.u[e]
  const w = span > 0 ? (f - flat.u[e]) / span : 0
  out.x = ring.xs[e] + (ring.xs[j] - ring.xs[e]) * w
  out.y = ring.ys[e] + (ring.ys[j] - ring.ys[e]) * w
}

/**
 * Anchor to anchor, when both have as many and none moves far (see the top of the file). `a2` and `b2` are the
 * contours in the space they are paired in; the pairs are made of the anchors of `a` and `b`.
 */
function directPairs(a: Ring, b: Ring, a2: Ring, b2: Ring): Pairs | null {
  if (a.n !== b.n) return null
  const limit = MORPH_LIMITS.directShare * Math.max(a2.size, b2.size)
  const limit2 = limit * limit
  /** The summed squared moves with this shift, or Infinity when one goes further than the limit. */
  const tries = (shift: number) => {
    let sum = 0
    for (let i = 0; i < a.n; i++) {
      const j = (i + shift) % b.n
      const dx = b2.xs[j] - a2.xs[i]
      const dy = b2.ys[j] - a2.ys[i]
      const d = dx * dx + dy * dy
      if (d > limit2) return Infinity
      sum += d
    }
    return sum
  }
  // The same start, or the anchor of `b` nearest the start of `a`.
  let nearest = 0
  let nearestD = Infinity
  for (let j = 0; j < b.n; j++) {
    const d = (b2.xs[j] - a2.xs[0]) ** 2 + (b2.ys[j] - a2.ys[0]) ** 2
    if (d < nearestD) {
      nearestD = d
      nearest = j
    }
  }
  // Whichever of the two moves the anchors least (a contour whose start moved by a few anchors keeps its place).
  const same = tries(0)
  const near = nearest !== 0 ? tries(nearest) : Infinity
  if (same === Infinity && near === Infinity) return null
  const shift = near < same ? nearest : 0
  const pairs = new Pairs()
  for (let i = 0; i < a.n; i++) {
    const j = (i + shift) % b.n
    pairs.push(a.xs[i], a.ys[i], b.xs[j], b.ys[j], true, false)
  }
  return pairs
}

/**
 * Both contours' anchors on both, each at its closest point on the other (see the top of the file) in the space of `a2` and `b2`
 * (the contours as Trajectory.straighten gives them: `a` and `b` themselves without it).
 */
function unionPairs(a: Ring, b: Ring, a2: Ring, b2: Ring): Pairs {
  // Straight trajectory: 'nearest' correspondence (None-Curve trajectory.ts STRAIGHT).
  const nearest = true
  const out = { d: 0 }
  // Where the start of the old contour lies on the new one: its closest point, or by the best turn.
  const s0 = nearest ? closestOn(b2, a2.xs[0], a2.ys[0], out) : bestShift(a2, b2)
  const s = s0 - Math.floor(s0)
  type Item = { u: number; v: number; fromA: boolean; i: number }
  const items: Item[] = []
  // The old outline's anchors: where they go on the new one, between s and s + 1 round it, in order.
  const onB = nearest ? inOrder(b2, a2.xs, a2.ys, a2.u.subarray(0, a.n), s) : null
  for (let i = 0; i < a.n; i++) items.push({ u: a2.u[i], v: onB ? onB[i] : a2.u[i] + s, fromA: true, i })
  // The new outline's anchors, in order round it from s: where they come from on the old one, in order too.
  const first = sideAt(b2, s) + (b2.u[sideAt(b2, s)] < s ? 1 : 0)
  const order = new Int32Array(b.n)
  const vs = new Float64Array(b.n)
  const qx = new Float64Array(b.n)
  const qy = new Float64Array(b.n)
  for (let k = 0; k < b.n; k++) {
    const j = (first + k) % b.n
    order[k] = j
    vs[k] = b2.u[j] < s ? b2.u[j] + 1 : b2.u[j]
    qx[k] = b2.xs[j]
    qy[k] = b2.ys[j]
  }
  const shares = vs.map((v) => v - s)
  const onA = nearest ? inOrder(a2, qx, qy, shares, 0) : null
  for (let k = 0; k < b.n; k++) items.push({ u: onA ? onA[k] : shares[k], v: vs[k], fromA: false, i: order[k] })
  items.sort((p, q) => p.u - q.u || p.v - q.v || (p.fromA === q.fromA ? 0 : p.fromA ? 1 : -1))
  // Keep the old anchors' places on the new outline in order between the new outline's own anchors.
  const n = items.length
  const lo = new Float64Array(n)
  const hi = new Float64Array(n)
  let below = s
  for (let k = 0; k < n; k++) {
    if (!items[k].fromA) below = items[k].v
    lo[k] = below
  }
  let above = s + 1
  for (let k = n - 1; k >= 0; k--) {
    if (!items[k].fromA) above = items[k].v
    hi[k] = above
  }
  let last = s
  for (let k = 0; k < n; k++) {
    const item = items[k]
    if (item.fromA) item.v = Math.max(last, Math.min(hi[k], Math.max(lo[k], item.v)))
    last = item.v
  }
  const pairs = new Pairs()
  const p = { x: 0, y: 0 }
  for (const item of items) {
    if (item.fromA) {
      pointOn(b, b2, item.v, p)
      pairs.push(a.xs[item.i], a.ys[item.i], p.x, p.y, false, true)
    } else {
      pointOn(a, a2, item.u, p)
      pairs.push(p.x, p.y, b.xs[item.i], b.ys[item.i], true, false)
    }
  }
  return pairs
}

/** Pairs each contour of `a` with one of `b` (see the top of the file); returns [index in a, index in b] pairs. */
function pairContours(a: Ring[], b: Ring[]): [number, number][] {
  const many = a.length > MORPH_LIMITS.manyContours || b.length > MORPH_LIMITS.manyContours
  const candidates: { i: number; j: number; cost: number }[] = []
  const weigh = (i: number, j: number) => {
    const p = a[i]
    const q = b[j]
    if (p.clockwise !== q.clockwise || p.n === 0 || q.n === 0) return null
    const scale = p.size + q.size
    const d = Math.hypot(p.cx - q.cx, p.cy - q.cy)
    if (d > MORPH_LIMITS.reach * scale) return null
    const ratio = Math.log(
      (Math.abs(p.area) + 1e-9 * scale * scale + 1e-12) / (Math.abs(q.area) + 1e-9 * scale * scale + 1e-12),
    )
    if (Math.abs(ratio) > Math.log(MORPH_LIMITS.areaRatio)) return null
    return (d * d) / (scale * scale || 1) + 0.25 * ratio * ratio
  }
  if (!many) {
    for (let i = 0; i < a.length; i++)
      for (let j = 0; j < b.length; j++) {
        const cost = weigh(i, j)
        if (cost !== null) candidates.push({ i, j, cost })
      }
  } else {
    const seen = new Set<number>()
    const near = (from: Ring[], to: Ring[], add: (x: number, y: number) => void) => {
      for (let x = 0; x < from.length; x++) {
        const order = to.map((r, y) => ({ y, d: (r.cx - from[x].cx) ** 2 + (r.cy - from[x].cy) ** 2 }))
        order.sort((p, q) => p.d - q.d)
        for (const { y } of order.slice(0, MORPH_LIMITS.neighbours)) add(x, y)
      }
    }
    const add = (i: number, j: number) => {
      const id = i * b.length + j
      if (seen.has(id)) return
      seen.add(id)
      const cost = weigh(i, j)
      if (cost !== null) candidates.push({ i, j, cost })
    }
    near(a, b, (i, j) => add(i, j))
    near(b, a, (j, i) => add(i, j))
  }
  candidates.sort((p, q) => p.cost - q.cost || p.i - q.i || p.j - q.j)
  const usedA = new Uint8Array(a.length)
  const usedB = new Uint8Array(b.length)
  const pairs: [number, number][] = []
  for (const { i, j } of candidates) {
    if (usedA[i] || usedB[j]) continue
    usedA[i] = 1
    usedB[j] = 1
    pairs.push([i, j])
  }
  return pairs
}

/** The same outline wound the other way round. */
function reversed(c: PolygonContour): PolygonContour {
  return { points: c.points.slice().reverse(), clockwise: !c.clockwise }
}

/**
 * Which way a glyph's outlines wind: the way its largest contour does. A merged outline (overlaps.ts) winds the other
 * way from the font's own, so a glyph whose effects start or stop folding it turns its whole winding over.
 */
function windsClockwise(rings: Ring[]): boolean | null {
  let best: Ring | null = null
  for (const r of rings) if (r.n > 0 && (!best || Math.abs(r.area) > Math.abs(best.area))) best = r
  return best && best.area !== 0 ? best.area < 0 : null
}

/** The share of the way round `r` of its point closest to (px, py), over all its sides; its distance into `out.d`. */
function closestOn(r: Ring, px: number, py: number, out: { d: number }): number {
  let best = 0
  let bestD = Infinity
  for (let e = 0; e < r.n; e++) {
    const j = e + 1 < r.n ? e + 1 : 0
    const x0 = r.xs[e]
    const y0 = r.ys[e]
    const dx = r.xs[j] - x0
    const dy = r.ys[j] - y0
    const len2 = dx * dx + dy * dy
    let w = len2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / len2 : 0
    w = w < 0 ? 0 : w > 1 ? 1 : w
    const qx = x0 + dx * w - px
    const qy = y0 + dy * w - py
    const d = qx * qx + qy * qy
    if (d < bestD) {
      bestD = d
      best = r.u[e] + (r.u[e + 1] - r.u[e]) * w
    }
  }
  out.d = Math.sqrt(bestD)
  return best
}

/**
 * The anchors of `r` (in the space of pairing `r2`) paired with their closest points on the other outline's contours
 * (`hosts`, `hosts2` in that space), when those lie within MORPH_LIMITS.attachShare of its size on average: `entering`
 * true, `r` is a new contour that grows out of the old outline; false, an old one that sinks into the new outline.
 * Null when they lie further (it grows out of or shrinks into its centre instead).
 */
function attachPairs(r: Ring, r2: Ring, hosts: Ring[], hosts2: Ring[], entering: boolean): Pairs | null {
  if (r.n === 0) return null
  const limit = MORPH_LIMITS.attachShare * r2.size
  const out = { d: 0 }
  const host = new Int32Array(r.n).fill(-1)
  const share = new Float64Array(r.n)
  let sum = 0
  for (let k = 0; k < r.n; k++) {
    const x = r2.xs[k]
    const y = r2.ys[k]
    let best = Infinity
    for (let h = 0; h < hosts2.length; h++) {
      const c = hosts2[h]
      if (c.n < 2) continue
      // The gap to its box: none of its points lies closer than that.
      const gx = Math.max(0, c.minX - x, x - c.maxX)
      const gy = Math.max(0, c.minY - y, y - c.maxY)
      if (gx * gx + gy * gy >= best * best) continue
      const t = closestOn(c, x, y, out)
      if (out.d < best) {
        best = out.d
        host[k] = h
        share[k] = t
      }
    }
    if (host[k] < 0) return null
    sum += best
    if (sum > limit * r.n) return null
  }
  const pairs = new Pairs()
  const p = { x: 0, y: 0 }
  for (let k = 0; k < r.n; k++) {
    pointOn(hosts[host[k]], hosts2[host[k]], share[k], p)
    if (entering) pairs.push(p.x, p.y, r.xs[k], r.ys[k], true, false)
    else pairs.push(r.xs[k], r.ys[k], p.x, p.y, false, true)
  }
  return pairs
}

/**
 * `pairs` when the attached end ('from' for a contour that grows, 'to' for one that sinks) is flat: its area at most
 * MORPH_LIMITS.flatShare of the contour's own. Fonts with overlapping contours (variable fonts are not merged) form a
 * counter between two contours; a contour attached along both encloses that counter and would fill it. Added here:
 * None-Curve pairs on merged outlines instead (glideOutline).
 */
function flatAt(pairs: Pairs | null, end: 'from' | 'to', own: Ring): Pairs | null {
  if (!pairs) return null
  const xs = end === 'from' ? pairs.sx : pairs.tx
  const ys = end === 'from' ? pairs.sy : pairs.ty
  let twice = 0
  for (let i = 0; i < xs.length; i++) {
    const j = (i + 1) % xs.length
    twice += xs[i] * ys[j] - xs[j] * ys[i]
  }
  return Math.abs(twice / 2) <= MORPH_LIMITS.flatShare * Math.abs(own.area) ? pairs : null
}

/**
 * Plans A → B: every contour of both as a track of paired anchors. Null when the glyph would need more than
 * MORPH_LIMITS.maxPoints anchors (it then switches at once).
 */
export function planMorph(from: PolygonGlyph, to: PolygonGlyph): MorphPlan | null {
  const a = from.contours.map(ringOf)
  let b = to.contours.map(ringOf)
  // B wound A's way, so every in-between contour winds one way (TrueType and CFF fonts wind opposite ways).
  const winds = windsClockwise(a)
  const windsTo = windsClockwise(b)
  if (winds !== null && windsTo !== null && winds !== windsTo) b = to.contours.map((c) => ringOf(reversed(c)))
  const tracks: Track[] = []
  let points = 0
  const add = (pairs: Pairs, clockwise: boolean) => {
    tracks.push(pairs.track(clockwise))
    points += pairs.sx.length
  }
  const pairedA = new Uint8Array(a.length)
  const partner = new Int32Array(b.length).fill(-1)
  for (const [i, j] of pairContours(a, b)) {
    pairedA[i] = 1
    partner[j] = i
  }
  for (let j = 0; j < b.length; j++) {
    const q = b[j]
    const i = partner[j]
    if (i >= 0) {
      const p = a[i]
      if (sameContour(p.contour, q.contour)) {
        const still = new Pairs()
        for (let k = 0; k < q.n; k++) still.push(q.xs[k], q.ys[k], q.xs[k], q.ys[k], true, false)
        add(still, q.contour.clockwise)
        continue
      }
      if (p.length > 0 && q.length > 0) {
        add(directPairs(p, q, p, q) ?? unionPairs(p, q, p, q), q.contour.clockwise)
        continue
      }
    }
    // A new contour grows out of the A outline it lies along, or else out of its centre.
    let grow = flatAt(attachPairs(q, q, a, a, true), 'from', q)
    if (!grow) {
      grow = new Pairs()
      for (let k = 0; k < q.n; k++) grow.push(q.cx, q.cy, q.xs[k], q.ys[k], true, false)
    }
    add(grow, q.contour.clockwise)
  }
  for (let i = 0; i < a.length; i++) {
    if (pairedA[i]) continue
    // A contour only A has sinks into the B outline it lies along, or else shrinks into its centre.
    const p = a[i]
    let shrink = flatAt(attachPairs(p, p, b, b, false), 'to', p)
    if (!shrink) {
      shrink = new Pairs()
      for (let k = 0; k < p.n; k++) shrink.push(p.xs[k], p.ys[k], p.cx, p.cy, false, true)
    }
    add(shrink, p.contour.clockwise)
  }
  return points > MORPH_LIMITS.maxPoints ? null : { tracks, points }
}
