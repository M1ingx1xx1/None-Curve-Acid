import { describe, expect, it } from 'vitest'
import { maskCell } from '../src/acid/engine'
import { parseSettingsFile, settingsFile } from '../src/state/persist'
import { canvasSize, DEFAULT_SETTINGS, sanitize } from '../src/state/settings'

describe('settings', () => {
  it('fills anything missing or invalid with defaults and clamps numbers', () => {
    expect(sanitize(null)).toEqual(DEFAULT_SETTINGS)
    const s = sanitize({ hardness: 7, mode: 'nope', ink: 'red', stops: [{ color: '#fff', pos: 2 }], fps: 24, text: 5 })
    expect(s.hardness).toBe(1)
    expect(s.mode).toBe(DEFAULT_SETTINGS.mode)
    expect(s.ink).toBe(DEFAULT_SETTINGS.ink)
    expect(s.stops).toEqual(DEFAULT_SETTINGS.stops)
    expect(s.fps).toBe(30)
    expect(s.text).toBe(DEFAULT_SETTINGS.text)
  })

  it('keeps valid values, sorting stops', () => {
    const stops = [
      { color: '#FF0000', pos: 1 },
      { color: '#00ff00', pos: 0 },
    ]
    const s = sanitize({ mode: 'decay', slant: 135, stops, fps: 60, transparent: true })
    expect(s.mode).toBe('decay')
    expect(s.slant).toBe(135)
    expect(s.fps).toBe(60)
    expect(s.transparent).toBe(true)
    expect(s.stops).toEqual([
      { color: '#00ff00', pos: 0 },
      { color: '#ff0000', pos: 1 },
    ])
  })

  it('round-trips through a settings file and refuses other files', () => {
    const s = { ...DEFAULT_SETTINGS, radius: 0.2, mode: 'follow' as const }
    expect(parseSettingsFile(settingsFile(s))).toEqual(s)
    expect(() => parseSettingsFile('{"a":1}')).toThrow()
    expect(() => parseSettingsFile('not json')).toThrow()
  })

  it('sizes the canvas by ratio and height, in even pixels', () => {
    expect(canvasSize({ ...DEFAULT_SETTINGS, aspect: '4:5', outputHeight: 1350 })).toEqual({
      width: 1080,
      height: 1350,
    })
    expect(canvasSize({ ...DEFAULT_SETTINGS, aspect: '16:9', outputHeight: 1080 })).toEqual({
      width: 1920,
      height: 1080,
    })
    expect(canvasSize({ ...DEFAULT_SETTINGS, aspect: 'custom', customWidth: 1001, customHeight: 777 })).toEqual({
      width: 1002,
      height: 778,
    })
    expect(maskCell(1350)).toBe(4)
  })
})
