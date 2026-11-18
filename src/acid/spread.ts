// Spread: a mask channel blurred wide and laid under itself, so a stroke reaches further out than the brush with a soft
// falloff, nearby strokes join into one patch, and a fading stroke thins out as it widens. Three box blurs in each
// direction (close to a Gaussian), each a running sum, so the cost does not grow with the radius. Pure.

/** One box blur of `radius` cells along rows (`horizontal`) or columns, `src` into `dst`; edges clamp. */
function boxPass(
  src: Float32Array,
  dst: Float32Array,
  cols: number,
  rows: number,
  radius: number,
  horizontal: boolean,
) {
  const lines = horizontal ? rows : cols
  const len = horizontal ? cols : rows
  const step = horizontal ? 1 : cols
  const inv = 1 / (2 * radius + 1)
  for (let l = 0; l < lines; l++) {
    const base = horizontal ? l * cols : l
    const at = (i: number) => src[base + Math.min(len - 1, Math.max(0, i)) * step]
    let sum = 0
    for (let i = -radius; i <= radius; i++) sum += at(i)
    for (let i = 0; i < len; i++) {
      dst[base + i * step] = sum * inv
      sum += at(i + radius + 1) - at(i - radius)
    }
  }
}

/**
 * `src` spread by about `radius` cells into `out`: the larger of the cell and its blurred surroundings (lifted by
 * `gain`, so a patch between strokes fills in). `tmp` is scratch the size of `src`.
 */
export function spreadField(
  src: Float32Array,
  out: Float32Array,
  tmp: Float32Array,
  cols: number,
  rows: number,
  radius: number,
  gain = 1.6,
): void {
  // Three boxes of radius r have a spread close to a Gaussian of sigma r.
  const r = Math.max(1, Math.round(radius / 1.7))
  boxPass(src, out, cols, rows, r, true)
  boxPass(out, tmp, cols, rows, r, true)
  boxPass(tmp, out, cols, rows, r, true)
  boxPass(out, tmp, cols, rows, r, false)
  boxPass(tmp, out, cols, rows, r, false)
  boxPass(out, tmp, cols, rows, r, false)
  for (let i = 0; i < src.length; i++) out[i] = Math.max(src[i], Math.min(1, tmp[i] * gain))
}
