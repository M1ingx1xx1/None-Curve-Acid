// Font loading: bytes → a fontkit font plus what the tool needs from it (None-Curve's src/font/parse.ts, cut down to a
// single face: no SVG artwork, no subset bundles, no collections picker, no kerning tables of its own since fontkit's
// layout applies kerning). fontkit is loaded on demand so it stays out of the initial bundle.

import type { Font } from 'fontkit'
import { FontLoadError } from './errors'
import type { GoogleFontRequest } from './google'
import { sniffFontFormat } from './sniff'

export type FontSource =
  | { kind: 'builtin'; file: string }
  | { kind: 'google'; request: GoogleFontRequest }
  | { kind: 'local'; fileName: string }

export interface LoadedFont {
  /** Changes with every load, so caches keyed on it never mix fonts. */
  id: number
  font: Font
  label: string
  source: FontSource
  unitsPerEm: number
  ascent: number
  descent: number
}

let loadId = 0

export async function parseFont(
  bytes: Uint8Array,
  label: string,
  source: FontSource,
  signal?: AbortSignal,
): Promise<LoadedFont> {
  const format = sniffFontFormat(bytes)
  const fontkit = await import('fontkit')
  signal?.throwIfAborted()
  let font: Font
  try {
    // fontkit's types ask for a Node Buffer; in the browser build a Uint8Array is what it reads.
    const parsed = fontkit.create(bytes as unknown as Buffer)
    // A collection: its first face.
    font = 'fonts' in parsed ? parsed.fonts[0] : parsed
    if (!font) throw new Error('the collection has no fonts')
    void font.numGlyphs
    void font.characterSet
    const upm = font.unitsPerEm
    if (!(Number.isFinite(upm) && upm > 0)) throw new Error(`unitsPerEm is ${upm}`)
  } catch (error) {
    if (error instanceof FontLoadError) throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new FontLoadError(
      'parse',
      `The ${format.toUpperCase()} data could not be read (${detail}). The file may be damaged.`,
    )
  }
  if (!font.numGlyphs) throw new FontLoadError('no-glyphs', 'The font contains no glyphs.')
  // A variable Google font loaded at a weight Google could not serve statically: apply the weight here.
  if (source.kind === 'google') {
    const axis = font.variationAxes?.wght
    const weight = source.request.weight
    if (axis && weight !== axis.default) {
      try {
        font = font.getVariation({ wght: Math.min(axis.max, Math.max(axis.min, weight)) })
      } catch {
        // WOFF2 variable fonts cannot be instanced by fontkit: the default instance stays.
      }
    }
  }
  return {
    id: ++loadId,
    font,
    label,
    source,
    unitsPerEm: font.unitsPerEm,
    ascent: font.ascent,
    descent: font.descent,
  }
}

/** Reads a file the user picked or dropped. */
export async function loadLocalFont(file: File): Promise<LoadedFont> {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    throw new FontLoadError('read-failed', `${file.name} could not be read.`)
  }
  return parseFont(bytes, file.name.replace(/\.[^.]+$/, ''), { kind: 'local', fileName: file.name })
}

/** The built-in fonts shipped in public/fonts (both from Google Fonts, SIL Open Font License). */
export const BUILTIN_FONTS = [
  { file: 'Roboto.ttf', label: 'Roboto' },
  { file: 'STIXTwoText.ttf', label: 'STIX Two Text' },
  { file: 'Space-Test.otf', label: 'Space Test' },
] as const

export async function loadBuiltinFont(file: string, signal?: AbortSignal): Promise<LoadedFont> {
  const entry = BUILTIN_FONTS.find((f) => f.file === file) ?? BUILTIN_FONTS[0]
  let response: Response
  try {
    response = await fetch(`${import.meta.env.BASE_URL}fonts/${entry.file}`, { signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new FontLoadError('download', `The built-in font ${entry.label} could not be loaded.`)
  }
  if (!response.ok) throw new FontLoadError('download', `The built-in font ${entry.label} could not be loaded.`)
  return parseFont(
    new Uint8Array(await response.arrayBuffer()),
    entry.label,
    { kind: 'builtin', file: entry.file },
    signal,
  )
}
