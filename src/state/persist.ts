// Settings and font choices kept in the browser (localStorage), and the settings as a JSON file to export and import.
// Every read goes through sanitize(), so a damaged or hand-edited copy can never break the page.

import type { GoogleFontRequest } from '../font/google'
import type { FontSource } from '../font/parse'
import { sanitize, type Settings } from './settings'

const SETTINGS_KEY = 'nc-acid:settings:v1'
const FONTS_KEY = 'nc-acid:fonts:v1'
export const CONFIG_KIND = 'none-curve-acid-settings'

/** A font choice that can be loaded again on the next visit (a local file cannot). */
export type FontChoice = { kind: 'builtin'; file: string } | { kind: 'google'; request: GoogleFontRequest }

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage full or blocked: the session still works, it is just not kept.
  }
}

export function loadSettings(): Settings {
  return sanitize(read(SETTINGS_KEY))
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings)
}

function readChoice(value: unknown): FontChoice | null {
  const v = value as Record<string, unknown> | null
  if (v?.kind === 'builtin' && typeof v.file === 'string') return { kind: 'builtin', file: v.file }
  const r = v?.request as Record<string, unknown> | undefined
  if (
    v?.kind === 'google' &&
    r &&
    typeof r.family === 'string' &&
    typeof r.weight === 'number' &&
    typeof r.italic === 'boolean' &&
    typeof r.subset === 'string'
  )
    return { kind: 'google', request: { family: r.family, weight: r.weight, italic: r.italic, subset: r.subset } }
  return null
}

export function loadFontChoices(): { a: FontChoice | null; b: FontChoice | null } {
  const v = read(FONTS_KEY) as Record<string, unknown> | null
  return { a: readChoice(v?.a), b: readChoice(v?.b) }
}

export function saveFontChoices(a: FontSource | undefined, b: FontSource | undefined): void {
  const keep = (s: FontSource | undefined) => (s && s.kind !== 'local' ? s : null)
  write(FONTS_KEY, { a: keep(a), b: keep(b) })
}

export function settingsFile(settings: Settings): string {
  return JSON.stringify({ kind: CONFIG_KIND, version: 1, settings }, null, 2)
}

/** An imported config file's settings; throws when the file is not one. */
export function parseSettingsFile(text: string): Settings {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('This file is not JSON.')
  }
  const d = data as Record<string, unknown> | null
  if (!d || d.kind !== CONFIG_KIND || typeof d.settings !== 'object')
    throw new Error('This is not a None-Curve Acid settings file.')
  return sanitize(d.settings)
}
