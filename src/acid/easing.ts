// Acid's animation curves: the classic polynomial eases (Quad to Quint), each In, Out or InOut, plus Linear. Pure.

export type EasePower = 'quad' | 'cubic' | 'quart' | 'quint'
export type EaseDirection = 'in' | 'out' | 'inOut'
export type EaseName = 'linear' | `${EasePower}${'In' | 'Out' | 'InOut'}`

const POWERS: Record<EasePower, number> = { quad: 2, cubic: 3, quart: 4, quint: 5 }

/** Every curve, Linear first, then by power with In, Out, InOut, for the Curve list. */
export const EASE_NAMES: readonly EaseName[] = [
  'linear',
  ...(Object.keys(POWERS) as EasePower[]).flatMap((p) => [`${p}In`, `${p}Out`, `${p}InOut`] as EaseName[]),
]

/** The label the panel shows, such as "Ease Cubic InOut". */
export function easeLabel(name: EaseName): string {
  if (name === 'linear') return 'Linear'
  const m = /^(quad|cubic|quart|quint)(In|Out|InOut)$/.exec(name)!
  return `Ease ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}`
}

export function isEaseName(value: unknown): value is EaseName {
  return typeof value === 'string' && (EASE_NAMES as readonly string[]).includes(value)
}

/** `name` at t (clamped to 0–1): 0 at 0, 1 at 1. */
export function ease(name: EaseName, t: number): number {
  if (!(t > 0)) return 0
  if (t >= 1) return 1
  if (name === 'linear') return t
  const m = /^(quad|cubic|quart|quint)(In|Out|InOut)$/.exec(name)
  if (!m) return t
  const n = POWERS[m[1] as EasePower]
  if (m[2] === 'In') return t ** n
  if (m[2] === 'Out') return 1 - (1 - t) ** n
  return t < 0.5 ? 2 ** (n - 1) * t ** n : 1 - (-2 * t + 2) ** n / 2
}
