// Every setting of the tool as one flat object: saved in the browser, exported and imported as a JSON file, reset in
// one click. sanitize() is the trust boundary for both the saved copy and an imported file. Pure: no React, no DOM.

import { EASE_NAMES, type EaseName } from '../acid/easing'

export type Align = 'left' | 'center' | 'right'
export type LetterCase = 'none' | 'upper' | 'lower'
/**
 * Hold: strokes stay until Clear. Decay: strokes fade over decayMs. Follow: the brush trails the pointer on a spring.
 * Auto: the brush sweeps back and forth along a straight line on its own (strokes fade as in Decay).
 */
export type BrushMode = 'hold' | 'decay' | 'follow' | 'auto'
export type FillRule = 'nonzero' | 'evenodd'
export type AspectName = '4:5' | '1:1' | '9:16' | '16:9' | 'custom'
/** Strobe: 'shape' jumps the letters between shapes; 'flash' lights them like a camera flash, shapes kept. */
export type StrobeMode = 'shape' | 'flash'
export const FPS_CHOICES = [30, 60, 90] as const
export type Fps = (typeof FPS_CHOICES)[number]

export interface GradientStop {
  color: string
  /** 0–1 along the gradient. */
  pos: number
}

export interface Settings {
  // Text
  text: string
  align: Align
  letterCase: LetterCase
  /** Font size, a share of the canvas height. */
  fontSize: number
  /** Line distance, in font sizes. */
  lineHeight: number
  /** Letter spacing, in ems. */
  tracking: number
  // Colours
  ink: string
  background: string
  transparent: boolean
  // Canvas
  aspect: AspectName
  outputHeight: number
  customWidth: number
  customHeight: number
  // Brush
  /** Radius, a share of the canvas height. */
  radius: number
  hardness: number
  /** How far the glow spreads out past the coloured area (0–1). */
  bleed: number
  edgeNoise: number
  strength: number
  /** Colour reaches this share of the radius further than the morph. */
  colorExtra: number
  mode: BrushMode
  decayMs: number
  /** Follow: 0 stiff, 1 loose. */
  spring: number
  /** Decay and follow fade along this curve. */
  fadeEase: EaseName
  /** Auto: where the sweep starts (canvas shares, 0 left / top). */
  autoX: number
  autoY: number
  /** Auto: direction in degrees, 0 left to right, 90 bottom to top. */
  autoAngle: number
  /** Auto: canvas heights a second. */
  autoSpeed: number
  /** Seep in: ms a stamped spot takes to rise to full (colour and shape), 0 at once. */
  seepMs: number
  /** 0–1: the brush outline pushed about by broad noise, so a big brush is not a circle. */
  shapeWarp: number
  /** 0–1: heavier and lighter patches inside the brush. */
  density: number
  // Morph
  /** A→B band: 1 follows the brush falloff as it is, near 0 switches A to B at half strength. */
  band: number
  maxMorph: number
  morphEase: EaseName
  /** One t per glyph (the mean under its anchors) instead of per anchor, for comparison. */
  perGlyph: boolean
  fillRule: FillRule
  /** ms the shape takes to rise on top of Seep in, so it changes after the colour arrives. */
  morphLag: number
  /** 0–1: how far past the brush the shape keeps changing, fading out. */
  morphSpread: number
  /** 0–1: extra anchors on long sides, so a change spreads along them. 0 adds none. */
  anchorDensity: number
  /** Strobe: letters under the brush jump between shapes. */
  strobe: boolean
  /** How far a strobe jump takes the shape, 0–1. */
  strobeAmount: number
  /** ms each strobe shape stays. */
  strobeHoldMs: number
  strobeMode: StrobeMode
  /** Exposure flash: how far a flash brightens (0–1; near 1 the letters briefly go white). */
  flashExposure: number
  /** Exposure flash: how strong and wide the light spills past the letters. */
  flashBloom: number
  /** Exposure flash: flashes a second. */
  flashRate: number
  /** Exposure flash: the light's colour. */
  flashColor: string
  /** Glitch: the in-between shapes torn, shifted and stretched, held longer, with a trail after the brush. */
  glitch: boolean
  /** 0–1: how far the in-between shapes stretch, shift and tear. */
  glitchAmount: number
  /** 0–1: how long the shapes and colour linger after the brush has passed (0 none, 1 about 2.5 s). */
  glitchTrail: number
  /** With two target fonts: the chance a letter takes B1 (the rest take B2). */
  b1Share: number
  // Acid
  stops: GradientStop[]
  slant: number
  flow: number
  noise: number
  glow: number
  spill: number
  /** Wash: the colour as a field on the canvas (0 off), its body, edge variety and dissolve, all 0–1. */
  wash: number
  washBody: number
  washEdge: number
  washDissolve: number
  /** 0–1: how far the colour spreads past the brush, joining nearby strokes. */
  spread: number
  /** Contour bleed: the letter keeps its ink in the middle, the gradient runs in from its outline and out past it. */
  contour: boolean
  /** 0–1: how far the gradient reaches in from the outline (more: less solid ink). */
  contourWidth: number
  /** 0–1: how strongly the gradient covers the ink. */
  contourStrength: number
  /** 0–1: how soft and wide the colour fades out past the outline. */
  contourSoft: number
  // Export
  fps: Fps
}

export const DEFAULT_TEXT = 'ACID WASH\nnone curve\ntype 2026'

export const PRESETS: { name: string; stops: GradientStop[] }[] = [
  {
    name: 'Brand',
    stops: [
      { color: '#6fd34e', pos: 0 },
      { color: '#2e73a0', pos: 0.5 },
      { color: '#9c82d0', pos: 1 },
    ],
  },
  {
    name: 'Acid Lime',
    stops: [
      { color: '#d4ff00', pos: 0 },
      { color: '#39ff88', pos: 0.55 },
      { color: '#f5ff3d', pos: 1 },
    ],
  },
  {
    name: 'Magenta Heat',
    stops: [
      { color: '#ff2bd6', pos: 0 },
      { color: '#ff5a1f', pos: 0.6 },
      { color: '#ffd23f', pos: 1 },
    ],
  },
  {
    name: 'Cyan Pink',
    stops: [
      { color: '#00f0ff', pos: 0 },
      { color: '#7a5cff', pos: 0.5 },
      { color: '#ff3ea5', pos: 1 },
    ],
  },
]

export const DEFAULT_SETTINGS: Settings = {
  text: DEFAULT_TEXT,
  align: 'center',
  letterCase: 'none',
  fontSize: 0.15,
  lineHeight: 1.05,
  tracking: 0,
  ink: '#111110',
  background: '#f4f4f2',
  transparent: false,
  aspect: '4:5',
  outputHeight: 1350,
  customWidth: 1200,
  customHeight: 1200,
  radius: 0.12,
  hardness: 0.3,
  bleed: 0.45,
  edgeNoise: 0.4,
  strength: 1,
  colorExtra: 0.25,
  mode: 'hold',
  decayMs: 2500,
  spring: 0.45,
  fadeEase: 'quadOut',
  autoX: 0,
  autoY: 0.5,
  autoAngle: 0,
  autoSpeed: 0.35,
  seepMs: 0,
  shapeWarp: 0,
  density: 0,
  band: 1,
  maxMorph: 1,
  morphEase: 'linear',
  perGlyph: false,
  fillRule: 'nonzero',
  morphLag: 0,
  morphSpread: 0,
  anchorDensity: 0,
  strobe: false,
  strobeAmount: 0.5,
  strobeHoldMs: 80,
  strobeMode: 'shape',
  flashExposure: 0.7,
  flashBloom: 0.5,
  flashRate: 4,
  flashColor: '#ffffff',
  glitch: false,
  glitchAmount: 0.5,
  glitchTrail: 0.5,
  b1Share: 0.5,
  stops: PRESETS[0].stops,
  slant: 45,
  flow: 0.35,
  noise: 0.5,
  glow: 0.8,
  spill: 0.4,
  wash: 0,
  washBody: 0.6,
  washEdge: 0.5,
  washDissolve: 0.2,
  spread: 0,
  contour: false,
  contourWidth: 0.3,
  contourStrength: 0.85,
  contourSoft: 0.5,
  fps: 60,
}

type NumberKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings]

/** Slider ranges: [min, max, step]. */
export const RANGES: Record<Exclude<NumberKey, 'fps'>, readonly [number, number, number]> = {
  fontSize: [0.03, 0.5, 0.005],
  lineHeight: [0.6, 2, 0.01],
  tracking: [-0.2, 0.5, 0.005],
  outputHeight: [256, 4096, 1],
  customWidth: [256, 4096, 1],
  customHeight: [256, 4096, 1],
  radius: [0.01, 0.5, 0.005],
  hardness: [0, 1, 0.01],
  bleed: [0, 1, 0.01],
  edgeNoise: [0, 1, 0.01],
  strength: [0, 1, 0.01],
  colorExtra: [0, 1, 0.01],
  decayMs: [100, 10000, 50],
  spring: [0, 1, 0.01],
  autoX: [0, 1, 0.01],
  autoY: [0, 1, 0.01],
  autoAngle: [0, 360, 1],
  autoSpeed: [0.05, 2, 0.01],
  seepMs: [0, 3000, 10],
  shapeWarp: [0, 1, 0.01],
  density: [0, 1, 0.01],
  morphLag: [0, 3000, 10],
  morphSpread: [0, 1, 0.01],
  anchorDensity: [0, 1, 0.05],
  strobeAmount: [0, 1, 0.01],
  strobeHoldMs: [16, 1000, 1],
  flashExposure: [0, 1, 0.01],
  flashBloom: [0, 1, 0.01],
  flashRate: [0.5, 15, 0.1],
  glitchAmount: [0, 1, 0.01],
  glitchTrail: [0, 1, 0.01],
  b1Share: [0, 1, 0.01],
  contourWidth: [0, 1, 0.01],
  contourStrength: [0, 1, 0.01],
  contourSoft: [0, 1, 0.01],
  wash: [0, 1, 0.01],
  washBody: [0, 1, 0.01],
  washEdge: [0, 1, 0.01],
  washDissolve: [0, 1, 0.01],
  spread: [0, 1, 0.01],
  band: [0, 1, 0.01],
  maxMorph: [0, 1, 0.01],
  slant: [0, 360, 1],
  flow: [0, 2, 0.01],
  noise: [0, 1, 0.01],
  glow: [0, 2, 0.01],
  spill: [0, 1, 0.01],
}

export const CHOICES = {
  align: ['left', 'center', 'right'],
  letterCase: ['none', 'upper', 'lower'],
  mode: ['hold', 'decay', 'follow', 'auto'],
  fillRule: ['nonzero', 'evenodd'],
  aspect: ['4:5', '1:1', '9:16', '16:9', 'custom'],
  fadeEase: EASE_NAMES,
  morphEase: EASE_NAMES,
  strobeMode: ['shape', 'flash'],
} as const satisfies Partial<Record<keyof Settings, readonly string[]>>

export const OUTPUT_HEIGHTS = [720, 1080, 1350, 1920, 2160, 2880, 3840] as const
export const STOP_LIMITS = { min: 2, max: 8 } as const
export const TEXT_LIMIT = 2000

export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (!m) return null
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return `#${hex.toLowerCase()}`
}

function sanitizeStops(value: unknown): GradientStop[] | null {
  if (!Array.isArray(value)) return null
  const stops: GradientStop[] = []
  for (const item of value) {
    const color = normalizeHex((item as GradientStop)?.color)
    const pos = (item as GradientStop)?.pos
    if (color && typeof pos === 'number' && Number.isFinite(pos))
      stops.push({ color, pos: Math.min(1, Math.max(0, pos)) })
  }
  if (stops.length < STOP_LIMITS.min || stops.length > STOP_LIMITS.max) return null
  return stops.sort((a, b) => a.pos - b.pos)
}

/** Any value (a saved copy, an imported file) as complete, valid settings: what does not fit takes the default. */
export function sanitize(input: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, stops: DEFAULT_SETTINGS.stops.map((s) => ({ ...s })) }
  if (!input || typeof input !== 'object') return out
  const raw = input as Record<string, unknown>
  const target = out as unknown as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = raw[key]
    if (value === undefined) continue
    if (key in RANGES) {
      const [min, max] = RANGES[key as keyof typeof RANGES]
      if (typeof value === 'number' && Number.isFinite(value)) target[key] = Math.min(max, Math.max(min, value))
    } else if (key in CHOICES) {
      if ((CHOICES[key as keyof typeof CHOICES] as readonly string[]).includes(value as string)) target[key] = value
    } else if (key === 'ink' || key === 'background' || key === 'flashColor') {
      target[key] = normalizeHex(value) ?? out[key]
    } else if (key === 'stops') {
      out.stops = sanitizeStops(value) ?? out.stops
    } else if (key === 'fps') {
      if ((FPS_CHOICES as readonly unknown[]).includes(value)) out.fps = value as Fps
    } else if (key === 'text') {
      if (typeof value === 'string') out.text = value.slice(0, TEXT_LIMIT)
    } else if (typeof value === typeof DEFAULT_SETTINGS[key]) {
      target[key] = value
    }
  }
  return out
}

const ASPECTS: Record<Exclude<AspectName, 'custom'>, number> = {
  '4:5': 4 / 5,
  '1:1': 1,
  '9:16': 9 / 16,
  '16:9': 16 / 9,
}

/** The canvas size in pixels; even numbers, which every video encoder takes. */
export function canvasSize(s: Pick<Settings, 'aspect' | 'outputHeight' | 'customWidth' | 'customHeight'>): {
  width: number
  height: number
} {
  const even = (v: number) => Math.max(2, 2 * Math.round(v / 2))
  if (s.aspect === 'custom') return { width: even(s.customWidth), height: even(s.customHeight) }
  return { width: even(s.outputHeight * ASPECTS[s.aspect]), height: even(s.outputHeight) }
}

export function applyCase(text: string, letterCase: LetterCase): string {
  return letterCase === 'upper' ? text.toUpperCase() : letterCase === 'lower' ? text.toLowerCase() : text
}
