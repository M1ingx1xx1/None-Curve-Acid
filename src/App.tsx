import { useCallback, useEffect, useRef, useState } from 'react'
import { AcidEngine } from './acid/engine'
import { FrameStats, type FrameSummary } from './acid/frameStats'
import { SLANT_PRESETS } from './acid/gradient'
import FontSlot, { type SlotState } from './components/FontSlot'
import GoogleFontsDialog from './components/GoogleFontsDialog'
import Icon from './components/Icon'
import { ColorField, EaseSelect, percent, Section, Segmented, Slider, Toggle } from './components/controls'
import StopsEditor from './components/StopsEditor'
import { downloadFile, safeFileName } from './export/download'
import { ticksDue, tickTime } from './export/clock'
import type { LiveRecorder } from './export/videoEncode'
import { toFontLoadError } from './font/errors'
import { History } from './state/history'
import { loadGoogleFont, type GoogleFontRequest } from './font/google'
import { loadBuiltinFont, loadLocalFont, type LoadedFont } from './font/parse'
import {
  loadFontChoices,
  loadSettings,
  parseSettingsFile,
  saveFontChoices,
  saveSettings,
  settingsFile,
  type FontChoice,
} from './state/persist'
import {
  canvasSize,
  DEFAULT_SETTINGS,
  FPS_CHOICES,
  OUTPUT_HEIGHTS,
  RANGES,
  sanitize,
  TEXT_LIMIT,
  type Fps,
  type Settings,
} from './state/settings'

/** A: the base font; b: target B1; b2: the optional second target. */
type Slot = 'a' | 'b' | 'b2'
type RecordState =
  | { kind: 'idle'; message?: string; tone?: 'info' | 'error' }
  | { kind: 'starting' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'saving' }

const DEFAULT_FONTS: Record<'a' | 'b', FontChoice> = {
  a: { kind: 'builtin', file: 'Roboto.ttf' },
  b: { kind: 'builtin', file: 'Space-Test.otf' },
}

/** m:ss (None-Curve export/videoFormat.ts formatClock). */
function formatClock(ms: number): string {
  const seconds = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Auto mode's quick directions: degrees and their arrows. */
const AUTO_DIRECTIONS = [
  [0, '→'],
  [45, '↗'],
  [90, '↑'],
  [135, '↖'],
  [180, '←'],
  [225, '↙'],
  [270, '↓'],
  [315, '↘'],
] as const

function choiceLabel(c: FontChoice): string {
  return c.kind === 'builtin' ? c.file.replace(/\.[^.]+$/, '') : c.request.family
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [fonts, setFonts] = useState<Record<Slot, SlotState>>(() => {
    const saved = loadFontChoices()
    return {
      a: { kind: 'loading', label: choiceLabel(saved.a ?? DEFAULT_FONTS.a) },
      b: { kind: 'loading', label: choiceLabel(saved.b ?? DEFAULT_FONTS.b) },
      b2: saved.b2 ? { kind: 'loading', label: choiceLabel(saved.b2) } : { kind: 'empty' },
    }
  })
  const [google, setGoogle] = useState<Slot | null>(null)
  const [panel, setPanel] = useState(true)
  const [record, setRecord] = useState<RecordState>({ kind: 'idle' })
  const [keepAlpha, setKeepAlpha] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [stats, setStats] = useState({ fps: 0, morphed: 0, auto: false })
  const [perf, setPerf] = useState<FrameSummary | null>(null)
  const [cursor, setCursor] = useState<{ x: number; y: number; r: number } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<AcidEngine | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const fontsRef = useRef(fonts)
  fontsRef.current = fonts
  const recorderRef = useRef<{ rec: LiveRecorder; startedAt: number; opaque: boolean; fps: number } | null>(null)
  const [glError, setGlError] = useState<string | null>(null)

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }))
  }, [])

  // Keep the settings in the browser (debounced).
  useEffect(() => {
    const t = setTimeout(() => saveSettings(settings), 300)
    return () => clearTimeout(t)
  }, [settings])

  // Undo / redo (⌘Z / ⇧⌘Z, Ctrl+Z / Ctrl+Y) over every setting: a change counts as a step once it settles.
  const historyRef = useRef<History<Settings> | null>(null)
  historyRef.current ??= new History(settings)
  useEffect(() => {
    const t = setTimeout(() => historyRef.current?.commit(settings), 400)
    return () => clearTimeout(t)
  }, [settings])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()
      const redo = (key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.metaKey)
      if (key !== 'z' && !redo) return
      e.preventDefault()
      const h = historyRef.current
      const now = settingsRef.current
      const next = h && (redo ? h.redo(now) : h.undo(now))
      if (next) setSettings(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Font loading.
  const loads = useRef<Record<Slot, AbortController | null>>({ a: null, b: null, b2: null })
  const saveFonts = (f: Record<Slot, SlotState>) => {
    // A slot still loading (or failed) keeps the choice saved before, so a reload mid-load does not lose it.
    const saved = loadFontChoices()
    const src = (s: SlotState, before: FontChoice | null) =>
      s.kind === 'ready' ? s.font.source : s.kind === 'empty' ? undefined : (before ?? undefined)
    saveFontChoices(src(f.a, saved.a), src(f.b, saved.b), src(f.b2, saved.b2))
  }
  const loadFont = useCallback((slot: Slot, label: string, load: (signal: AbortSignal) => Promise<LoadedFont>) => {
    loads.current[slot]?.abort()
    const controller = new AbortController()
    loads.current[slot] = controller
    setFonts((f) => ({ ...f, [slot]: { kind: 'loading', label } }))
    load(controller.signal).then(
      (font) => {
        if (controller.signal.aborted) return
        setFonts((f) => {
          const next = { ...f, [slot]: { kind: 'ready', font } as SlotState }
          saveFonts(next)
          return next
        })
      },
      (error) => {
        if (controller.signal.aborted) return
        setFonts((f) => ({ ...f, [slot]: { kind: 'error', error: toFontLoadError(error, 'parse') } }))
      },
    )
  }, [])
  const removeFont = (slot: Slot) => {
    loads.current[slot]?.abort()
    loads.current[slot] = null
    setFonts((f) => {
      const next = { ...f, [slot]: { kind: 'empty' } as SlotState }
      saveFonts(next)
      return next
    })
  }
  const loadChoice = useCallback(
    (slot: Slot, c: FontChoice) =>
      c.kind === 'builtin'
        ? loadFont(slot, choiceLabel(c), (signal) => loadBuiltinFont(c.file, signal))
        : loadFont(slot, choiceLabel(c), (signal) => loadGoogleFont(c.request, signal)),
    [loadFont],
  )
  useEffect(() => {
    const saved = loadFontChoices()
    loadChoice('a', saved.a ?? DEFAULT_FONTS.a)
    loadChoice('b', saved.b ?? DEFAULT_FONTS.b)
    if (saved.b2) loadChoice('b2', saved.b2)
  }, [loadChoice])

  // The engine and its frame loop.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let engine: AcidEngine
    try {
      engine = new AcidEngine(canvas)
    } catch (error) {
      setGlError(error instanceof Error ? error.message : String(error))
      return
    }
    engineRef.current = engine
    let raf = 0
    let lastStats = 0
    const frames = new FrameStats()
    const tick = (now: number) => {
      const t0 = performance.now()
      raf = requestAnimationFrame(tick)
      const f = fontsRef.current
      const s = settingsRef.current
      const rec = recorderRef.current
      // An MP4 cannot be transparent: while one records, the background is painted.
      const look = rec?.opaque && s.transparent ? { ...s, transparent: false } : s
      const fontA = f.a.kind === 'ready' ? f.a.font : null
      // Targets: B1 and B2, whichever are loaded (B1 first).
      // B1 is required: without it (loading or failed) nothing morphs, even when B2 is there.
      const targets = f.b.kind === 'ready' ? [f.b, f.b2].flatMap((t) => (t.kind === 'ready' ? [t.font] : [])) : []
      if (rec) {
        // Recording: one frame drawn for every tick of the take, at that tick's time, each captured on its own.
        engine.fixedClock = true
        const due = ticksDue(now - rec.startedAt, rec.rec.ticks, rec.fps)
        for (let i = 0; i < due && !rec.rec.busy; i++) {
          engine.frame(rec.startedAt + tickTime(rec.rec.ticks, rec.fps), look, fontA, targets)
          rec.rec.capture()
        }
      } else {
        engine.fixedClock = false
        engine.frame(now, look, fontA, targets)
      }
      frames.record(now, performance.now() - t0)
      if (now - lastStats > 250) {
        lastStats = now
        setPerf(frames.summary())
        setStats({ fps: 1000 / engine.frameMs, morphed: engine.morphed, auto: engine.autoActive })
        if (rec) setElapsed(now - rec.startedAt)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const { width, height } = canvasSize(settingsRef.current)
    return {
      x: ((e.clientX - rect.left) / rect.width) * width,
      y: ((e.clientY - rect.top) / rect.height) * height,
      cx: e.clientX - rect.left,
      cy: e.clientY - rect.top,
      r: settingsRef.current.radius * rect.height,
    }
  }
  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toCanvas(e)
    engineRef.current?.pointerMove(p.x, p.y, (e.buttons & 1) === 1, e.timeStamp)
    setCursor({ x: p.cx, y: p.cy, r: p.r })
  }

  const startRecording = async () => {
    const canvas = canvasRef.current
    if (!canvas || record.kind !== 'idle') return
    const alpha = settings.transparent && keepAlpha
    setRecord({ kind: 'starting' })
    try {
      const { LiveRecorder } = await import('./export/videoEncode')
      const rec = await LiveRecorder.start(canvas, settings.fps, alpha ? 'webm' : 'mp4', alpha)
      const startedAt = performance.now()
      recorderRef.current = { rec, startedAt, opaque: !alpha, fps: settings.fps }
      setElapsed(0)
      setRecord({ kind: 'recording', startedAt })
    } catch (error) {
      setRecord({ kind: 'idle', message: error instanceof Error ? error.message : String(error), tone: 'error' })
    }
  }
  const stopRecording = async () => {
    const current = recorderRef.current
    if (!current) return
    recorderRef.current = null
    const ms = performance.now() - current.startedAt
    setRecord({ kind: 'saving' })
    try {
      const result = await current.rec.stop()
      const name = safeFileName(['none-curve-acid', new Date().toISOString().slice(0, 19)], result.format)
      downloadFile(result.blob, name, result.blob.type)
      const notes = [
        result.fellBack ? 'This browser cannot write MP4: saved as WebM.' : '',
        settings.transparent && result.format === 'webm' && keepAlpha ? 'Transparent background (WebM, VP9).' : '',
        `${result.frames} frames at ${current.fps} fps, each drawn on its own.`,
        result.durationMs < ms * 0.95
          ? `The page drew slower than ${current.fps} fps, so the video's clock waited: it plays ${(result.durationMs / 1000).toFixed(2)} s of a ${(ms / 1000).toFixed(2)} s take, smoothly.`
          : '',
      ].filter(Boolean)
      setRecord({
        kind: 'idle',
        message: `Saved ${name} (${formatClock(result.durationMs)}, ${(result.durationMs / 1000).toFixed(2)} s).${notes.length ? ` ${notes.join(' ')}` : ''}`,
        tone: 'info',
      })
    } catch (error) {
      setRecord({ kind: 'idle', message: error instanceof Error ? error.message : String(error), tone: 'error' })
    }
  }

  const savePng = () => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return
      const name = safeFileName(['none-curve-acid', new Date().toISOString().slice(0, 19)], 'png')
      downloadFile(blob, name, 'image/png')
      setNotice(`Saved ${name}.`)
    }, 'image/png')
  }

  const importRef = useRef<HTMLInputElement>(null)
  const size = canvasSize(settings)
  const recording = record.kind === 'recording'
  const fontHint = (slot: Slot) =>
    slot === 'a'
      ? 'The text as it stands. The font None-Curve started from matches B best.'
      : slot === 'b'
        ? 'The shape the brush paints in: a TTF exported from None-Curve.'
        : 'Optional. With two targets each letter the brush reaches turns into B1 or B2, picked anew each time.'
  const twoTargets = fonts.b.kind !== 'empty' && fonts.b2.kind !== 'empty'

  return (
    <div className="app" data-panel={panel ? 'open' : 'closed'}>
      <header className="header">
        <div className="brand">
          <h1>None-Curve</h1>
          <span className="brand-tag">Acid brush</span>
        </div>
        <div className="header-actions">
          <button type="button" onClick={() => engineRef.current?.clear()}>
            <Icon name="reset" />
            Clear
          </button>
          <button
            type="button"
            className={recording ? 'button-primary record-on' : ''}
            aria-disabled={record.kind === 'starting' || record.kind === 'saving' || undefined}
            onClick={() => (recording ? stopRecording() : startRecording())}
          >
            <Icon name={recording ? 'stop' : 'record'} />
            {recording ? 'Stop' : 'Record'}
            {(recording || record.kind === 'saving') && <output className="record-time">{formatClock(elapsed)}</output>}
          </button>
          <button type="button" onClick={savePng}>
            <Icon name="download" />
            PNG
          </button>
          <button type="button" aria-pressed={!panel} onClick={() => setPanel((p) => !p)}>
            {panel ? 'Hide panel' : 'Show panel'}
          </button>
        </div>
      </header>

      <div className="workspace">
        {panel && (
          <aside className="side panel" aria-label="Settings">
            <Section title="Fonts">
              <FontSlot
                title="A · Base font"
                hint={fontHint('a')}
                state={fonts.a}
                onFile={(file) => loadFont('a', file.name, () => loadLocalFont(file))}
                onGoogle={() => setGoogle('a')}
                onBuiltin={(file) => loadChoice('a', { kind: 'builtin', file })}
              />
              <FontSlot
                title="B1 · Target font"
                hint={fontHint('b')}
                state={fonts.b}
                onFile={(file) => loadFont('b', file.name, () => loadLocalFont(file))}
                onGoogle={() => setGoogle('b')}
                onBuiltin={(file) => loadChoice('b', { kind: 'builtin', file })}
              />
              <FontSlot
                title="B2 · Target font"
                hint={fontHint('b2')}
                state={fonts.b2}
                onFile={(file) => loadFont('b2', file.name, () => loadLocalFont(file))}
                onGoogle={() => setGoogle('b2')}
                onBuiltin={(file) => loadChoice('b2', { kind: 'builtin', file })}
                onRemove={() => removeFont('b2')}
              />
              {twoTargets && (
                <Slider
                  label="B1 / B2"
                  value={settings.b1Share}
                  range={RANGES.b1Share}
                  format={(v) => `${Math.round(v * 100)} / ${100 - Math.round(v * 100)}`}
                  onChange={(v) => set('b1Share', v)}
                  hint="The chance a letter turns into B1 rather than B2. A letter keeps its pick until it is back to A."
                />
              )}
            </Section>

            <Section title="Text">
              <div className="field">
                <label htmlFor="text">Text</label>
                <textarea
                  id="text"
                  rows={3}
                  maxLength={TEXT_LIMIT}
                  value={settings.text}
                  onChange={(e) => set('text', e.target.value)}
                />
              </div>
              <div className="field-row">
                <Segmented
                  label="Align"
                  value={settings.align}
                  onChange={(v) => set('align', v)}
                  options={[
                    { value: 'left', label: <Icon name="alignLeft" />, title: 'Left' },
                    { value: 'center', label: <Icon name="alignCenter" />, title: 'Centre' },
                    { value: 'right', label: <Icon name="alignRight" />, title: 'Right' },
                  ]}
                />
                <Segmented
                  label="Case"
                  value={settings.letterCase}
                  onChange={(v) => set('letterCase', v)}
                  options={[
                    { value: 'none', label: 'Aa', title: 'As typed' },
                    { value: 'upper', label: 'AA', title: 'Upper case' },
                    { value: 'lower', label: 'aa', title: 'Lower case' },
                  ]}
                />
              </div>
              <Slider
                label="Size"
                value={settings.fontSize}
                range={RANGES.fontSize}
                format={percent}
                onChange={(v) => set('fontSize', v)}
              />
              <Slider
                label="Line height"
                value={settings.lineHeight}
                range={RANGES.lineHeight}
                onChange={(v) => set('lineHeight', v)}
              />
              <Slider
                label="Letter spacing"
                value={settings.tracking}
                range={RANGES.tracking}
                format={(v) => `${v.toFixed(3)} em`}
                onChange={(v) => set('tracking', v)}
              />
            </Section>

            <Section title="Brush">
              <Segmented
                label="Mode"
                value={settings.mode}
                onChange={(v) => set('mode', v)}
                options={[
                  { value: 'hold', label: 'Hold', title: 'Strokes stay until Clear' },
                  { value: 'decay', label: 'Decay', title: 'Strokes fade out' },
                  { value: 'follow', label: 'Follow', title: 'The brush trails the pointer on a spring' },
                  { value: 'auto', label: 'Auto', title: 'The brush sweeps a straight line on its own' },
                ]}
              />
              <p className="field-hint">
                {settings.mode === 'follow'
                  ? 'Hover to paint; the trail fades.'
                  : settings.mode === 'auto'
                    ? 'Sweeps from the start to the far edge and back; the trail fades. Moving the pointer takes over, and the sweep comes back 1.5 s after it stops.'
                    : 'Press and drag to paint.'}
              </p>
              <Slider
                label="Radius"
                value={settings.radius}
                range={RANGES.radius}
                format={percent}
                onChange={(v) => set('radius', v)}
              />
              <Slider
                label="Hardness"
                value={settings.hardness}
                range={RANGES.hardness}
                onChange={(v) => set('hardness', v)}
                hint="Soft: a wide ring of in-between shapes and colour. Hard: A switches to B at the edge."
              />
              <Slider
                label="Bleed"
                value={settings.bleed}
                range={RANGES.bleed}
                onChange={(v) => set('bleed', v)}
                hint="How far the glow spreads."
              />
              <Slider
                label="Colour reach"
                value={settings.colorExtra}
                range={RANGES.colorExtra}
                format={percent}
                onChange={(v) => set('colorExtra', v)}
                hint="Colour goes this much further than the morph."
              />
              <Slider
                label="Edge noise"
                value={settings.edgeNoise}
                range={RANGES.edgeNoise}
                onChange={(v) => set('edgeNoise', v)}
              />
              <Slider
                label="Strength"
                value={settings.strength}
                range={RANGES.strength}
                format={percent}
                onChange={(v) => set('strength', v)}
              />
              <Slider
                label="Shape warp"
                value={settings.shapeWarp}
                range={RANGES.shapeWarp}
                onChange={(v) => set('shapeWarp', v)}
                hint="Pushes the outline about, so a big brush is not a circle."
              />
              <Slider
                label="Density"
                value={settings.density}
                range={RANGES.density}
                onChange={(v) => set('density', v)}
                hint="Heavier and lighter patches inside the brush."
              />
              <Slider
                label="Seep in"
                value={settings.seepMs}
                range={RANGES.seepMs}
                format={(v) => `${(v / 1000).toFixed(2)} s`}
                onChange={(v) => set('seepMs', v)}
                hint="How long a painted spot takes to rise to full colour and shape. 0: at once."
              />
              {settings.mode !== 'hold' && (
                <>
                  <Slider
                    label="Fade time"
                    value={settings.decayMs}
                    range={RANGES.decayMs}
                    format={(v) => `${(v / 1000).toFixed(2)} s`}
                    onChange={(v) => set('decayMs', v)}
                  />
                  <EaseSelect label="Fade curve" value={settings.fadeEase} onChange={(v) => set('fadeEase', v)} />
                </>
              )}
              {settings.mode === 'auto' && (
                <>
                  <div className="field-row">
                    <Slider
                      label="Start X"
                      value={settings.autoX}
                      range={RANGES.autoX}
                      format={percent}
                      onChange={(v) => set('autoX', v)}
                    />
                    <Slider
                      label="Start Y"
                      value={settings.autoY}
                      range={RANGES.autoY}
                      format={percent}
                      onChange={(v) => set('autoY', v)}
                    />
                  </div>
                  <div className="field">
                    <span className="field-label">Direction</span>
                    <div className="segmented" role="group" aria-label="Direction presets">
                      {AUTO_DIRECTIONS.map(([deg, arrow]) => (
                        <button
                          key={deg}
                          type="button"
                          aria-label={`${deg}°`}
                          title={`${deg}°`}
                          aria-pressed={settings.autoAngle === deg}
                          onClick={() => set('autoAngle', deg)}
                        >
                          {arrow}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Slider
                    label="Angle"
                    value={settings.autoAngle}
                    range={RANGES.autoAngle}
                    format={(v) => `${Math.round(v)}°`}
                    onChange={(v) => set('autoAngle', v)}
                    hint="0° left to right, 90° bottom to top, 180° right to left."
                  />
                  <Slider
                    label="Speed"
                    value={settings.autoSpeed}
                    range={RANGES.autoSpeed}
                    onChange={(v) => set('autoSpeed', v)}
                  />
                </>
              )}
              {(settings.mode === 'follow' || settings.mode === 'auto') && (
                <Slider
                  label="Spring"
                  value={settings.spring}
                  range={RANGES.spring}
                  onChange={(v) => set('spring', v)}
                  hint="0 stiff, 1 loose: how far the brush lags and swings."
                />
              )}
              <button type="button" className="button-small" onClick={() => engineRef.current?.clear()}>
                <Icon name="reset" />
                Clear
              </button>
            </Section>

            <Section title="Morph">
              <Slider
                label="A→B band"
                value={settings.band}
                range={RANGES.band}
                format={percent}
                onChange={(v) => set('band', v)}
                hint="100%: the shapes follow the brush falloff. Lower: A switches to B over a narrower band."
              />
              <Toggle
                label="Glitch"
                checked={settings.glitch}
                onChange={(v) => set('glitch', v)}
                hint="In-between shapes stretch, shift, break and tear before they come back together, and stay longer; the brush leaves a trail."
              />
              {settings.glitch && (
                <>
                  <Slider
                    label="Glitch amount"
                    value={settings.glitchAmount}
                    range={RANGES.glitchAmount}
                    format={percent}
                    onChange={(v) => set('glitchAmount', v)}
                    hint="How far the in-between shapes stretch and tear, and how long they hold."
                  />
                  <Slider
                    label="Trail"
                    value={settings.glitchTrail}
                    range={RANGES.glitchTrail}
                    format={percent}
                    onChange={(v) => set('glitchTrail', v)}
                    hint="How long the shapes and colour linger after the brush has passed."
                  />
                </>
              )}
              <Slider
                label="Max morph"
                value={settings.maxMorph}
                range={RANGES.maxMorph}
                format={percent}
                onChange={(v) => set('maxMorph', v)}
                hint="50%: at most the average of A and B."
              />
              <EaseSelect label="Morph curve" value={settings.morphEase} onChange={(v) => set('morphEase', v)} />
              <Toggle
                label="Whole glyph"
                checked={settings.perGlyph}
                onChange={(v) => set('perGlyph', v)}
                hint="One amount per letter instead of per anchor, for comparison."
              />
              <Slider
                label="Morph lag"
                value={settings.morphLag}
                range={RANGES.morphLag}
                format={(v) => `${(v / 1000).toFixed(2)} s`}
                onChange={(v) => set('morphLag', v)}
                hint="The shape takes this much longer than the colour to change."
              />
              <Slider
                label="Morph spread"
                value={settings.morphSpread}
                range={RANGES.morphSpread}
                format={percent}
                onChange={(v) => set('morphSpread', v)}
                hint="The change reaches past the brush and fades out, so it passes to the letters around."
              />
              <Slider
                label="Anchor density"
                value={settings.anchorDensity}
                range={RANGES.anchorDensity}
                format={percent}
                onChange={(v) => set('anchorDensity', v)}
                hint="Adds anchors along long sides of A and B (their own anchors stay), so a stretch runs along them."
              />
              <Toggle
                label="Strobe"
                checked={settings.strobe}
                onChange={(v) => set('strobe', v)}
                hint="Shape: letters under the brush jump between shapes. Exposure flash: they flash like a camera strobe."
              />
              {settings.strobe && (
                <Segmented
                  label="Strobe mode"
                  value={settings.strobeMode}
                  onChange={(v) => set('strobeMode', v)}
                  options={[
                    { value: 'shape', label: 'Shape', title: 'Letters jump between shapes' },
                    { value: 'flash', label: 'Exposure flash', title: 'Letters flash bright; shapes stay put' },
                  ]}
                />
              )}
              {settings.strobe && settings.strobeMode === 'flash' && (
                <>
                  <Slider
                    label="Exposure"
                    value={settings.flashExposure}
                    range={RANGES.flashExposure}
                    format={percent}
                    onChange={(v) => set('flashExposure', v)}
                    hint="How bright each flash goes; near 100% the letters briefly blow out to the light's colour."
                  />
                  <Slider
                    label="Bloom"
                    value={settings.flashBloom}
                    range={RANGES.flashBloom}
                    format={percent}
                    onChange={(v) => set('flashBloom', v)}
                    hint="How strongly and how far the light spills past the letters."
                  />
                  <Slider
                    label="Flash rate"
                    value={settings.flashRate}
                    range={RANGES.flashRate}
                    format={(v) => `${v.toFixed(1)} /s`}
                    onChange={(v) => set('flashRate', v)}
                  />
                  <ColorField label="Light colour" value={settings.flashColor} onChange={(v) => set('flashColor', v)} />
                </>
              )}
              {settings.strobe && settings.strobeMode === 'shape' && (
                <>
                  <Slider
                    label="Strobe strength"
                    value={settings.strobeAmount}
                    range={RANGES.strobeAmount}
                    format={percent}
                    onChange={(v) => set('strobeAmount', v)}
                  />
                  <Slider
                    label="Strobe hold"
                    value={settings.strobeHoldMs}
                    range={RANGES.strobeHoldMs}
                    format={(v) => `${Math.round(v)} ms`}
                    onChange={(v) => set('strobeHoldMs', v)}
                    hint="How long each shape stays."
                  />
                </>
              )}
              <Segmented
                label="Fill rule"
                value={settings.fillRule}
                onChange={(v) => set('fillRule', v)}
                options={[
                  { value: 'nonzero', label: 'Nonzero' },
                  { value: 'evenodd', label: 'Even-odd' },
                ]}
              />
            </Section>

            <Section title="Acid">
              <StopsEditor stops={settings.stops} onChange={(v) => set('stops', v)} />
              <div className="field">
                <span className="field-label">Gradient slant</span>
                <div className="segmented" role="group" aria-label="Slant presets">
                  {SLANT_PRESETS.map((d) => (
                    <button key={d} type="button" aria-pressed={settings.slant === d} onClick={() => set('slant', d)}>
                      {d}°
                    </button>
                  ))}
                </div>
              </div>
              <Slider
                label="Slant"
                value={settings.slant}
                range={RANGES.slant}
                format={(v) => `${Math.round(v)}°`}
                onChange={(v) => set('slant', v)}
              />
              <Slider label="Flow" value={settings.flow} range={RANGES.flow} onChange={(v) => set('flow', v)} />
              <Slider label="Noise" value={settings.noise} range={RANGES.noise} onChange={(v) => set('noise', v)} />
              <Slider label="Glow" value={settings.glow} range={RANGES.glow} onChange={(v) => set('glow', v)} />
              <Slider
                label="Spill"
                value={settings.spill}
                range={RANGES.spill}
                format={percent}
                onChange={(v) => set('spill', v)}
                hint="The glow outside the letters; 0 colours inside only."
              />
              <Slider
                label="Wash"
                value={settings.wash}
                range={RANGES.wash}
                format={percent}
                onChange={(v) => set('wash', v)}
                hint="The colour as a field over the canvas where the brush has been, not only in the letters."
              />
              {settings.wash > 0 && (
                <>
                  <Slider
                    label="Wash body"
                    value={settings.washBody}
                    range={RANGES.washBody}
                    format={percent}
                    onChange={(v) => set('washBody', v)}
                    hint="0: a soft falloff. 100%: a solid patch with an edge."
                  />
                  <Slider
                    label="Edge variety"
                    value={settings.washEdge}
                    range={RANGES.washEdge}
                    format={percent}
                    onChange={(v) => set('washEdge', v)}
                    hint="How much the edge changes from hard to soft along it."
                  />
                  <Slider
                    label="Dissolve"
                    value={settings.washDissolve}
                    range={RANGES.washDissolve}
                    format={percent}
                    onChange={(v) => set('washDissolve', v)}
                    hint="Patches that fade into the background."
                  />
                </>
              )}
              <Slider
                label="Spread"
                value={settings.spread}
                range={RANGES.spread}
                format={percent}
                onChange={(v) => set('spread', v)}
                hint="The colour spreads past the brush and joins nearby strokes."
              />
              <Toggle
                label="Contour bleed"
                checked={settings.contour}
                onChange={(v) => set('contour', v)}
                hint="The letters keep their ink in the middle; the gradient runs in from the outline and fades out past it."
              />
              {settings.contour && (
                <>
                  <Slider
                    label="Bleed width"
                    value={settings.contourWidth}
                    range={RANGES.contourWidth}
                    format={percent}
                    onChange={(v) => set('contourWidth', v)}
                    hint="How far the gradient reaches in from the outline: more gradient, less solid ink."
                  />
                  <Slider
                    label="Gradient strength"
                    value={settings.contourStrength}
                    range={RANGES.contourStrength}
                    format={percent}
                    onChange={(v) => set('contourStrength', v)}
                  />
                  <Slider
                    label="Edge softness"
                    value={settings.contourSoft}
                    range={RANGES.contourSoft}
                    format={percent}
                    onChange={(v) => set('contourSoft', v)}
                    hint="How soft and wide the colour fades out past the outline."
                  />
                </>
              )}
            </Section>

            <Section title="Canvas">
              <Segmented
                label="Ratio"
                value={settings.aspect}
                onChange={(v) => set('aspect', v)}
                options={(['4:5', '1:1', '9:16', '16:9', 'custom'] as const).map((v) => ({
                  value: v,
                  label: v === 'custom' ? 'Custom' : v,
                }))}
              />
              {settings.aspect === 'custom' ? (
                <div className="field-row">
                  {(['customWidth', 'customHeight'] as const).map((k) => (
                    <div className="field" key={k}>
                      <label htmlFor={k}>{k === 'customWidth' ? 'Width' : 'Height'}</label>
                      <input
                        id={k}
                        type="number"
                        min={RANGES[k][0]}
                        max={RANGES[k][1]}
                        value={settings[k]}
                        onChange={(e) => set(k, sanitize({ ...settings, [k]: Number(e.target.value) })[k])}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="field">
                  <label htmlFor="out-h">Output height</label>
                  <select
                    id="out-h"
                    value={settings.outputHeight}
                    onChange={(e) => set('outputHeight', Number(e.target.value))}
                  >
                    {OUTPUT_HEIGHTS.map((h) => (
                      <option key={h} value={h}>
                        {h} px
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <p className="field-hint">
                {size.width} × {size.height} px
              </p>
              <div className="field-row">
                <ColorField label="Ink" value={settings.ink} onChange={(v) => set('ink', v)} />
                <ColorField label="Background" value={settings.background} onChange={(v) => set('background', v)} />
              </div>
              <Toggle
                label="Transparent background"
                checked={settings.transparent}
                onChange={(v) => set('transparent', v)}
              />
            </Section>

            <Section title="Export">
              <Segmented
                label="Video frame rate"
                value={String(settings.fps) as `${Fps}`}
                onChange={(v) => set('fps', Number(v) as Fps)}
                options={FPS_CHOICES.map((f) => ({ value: `${f}` as const, label: `${f} fps` }))}
              />
              <p className="field-hint">
                Every frame of the video is drawn on its own at its own time, at any rate, so nothing is repeated.
              </p>
              {settings.transparent && (
                <>
                  <p className="panel-notice">
                    MP4 cannot be transparent. Keep transparency to record a WebM (VP9 with alpha); otherwise the MP4 is
                    recorded on the background colour.
                  </p>
                  <Toggle label="Keep transparency (WebM, VP9)" checked={keepAlpha} onChange={setKeepAlpha} />
                </>
              )}
              <div className="slot-actions">
                <button
                  type="button"
                  className="button-small"
                  onClick={() =>
                    downloadFile(settingsFile(settings), 'none-curve-acid-settings.json', 'application/json')
                  }
                >
                  <Icon name="download" />
                  Export settings
                </button>
                <button type="button" className="button-small" onClick={() => importRef.current?.click()}>
                  <Icon name="upload" />
                  Import settings
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file) return
                    try {
                      setSettings(parseSettingsFile(await file.text()))
                      setNotice(`Imported ${file.name}.`)
                    } catch (error) {
                      setNotice(error instanceof Error ? error.message : String(error))
                    }
                  }}
                />
                <button
                  type="button"
                  className="button-small"
                  onClick={() => {
                    setSettings({ ...DEFAULT_SETTINGS })
                    engineRef.current?.clear()
                  }}
                >
                  <Icon name="reset" />
                  Reset all
                </button>
              </div>
              {notice && <p className="field-hint">{notice}</p>}
            </Section>

            <Section title="Performance">
              {perf ? (
                <dl className="perf">
                  <dt>Frame rate</dt>
                  <dd>{perf.fps.toFixed(1)} fps</dd>
                  <dt>Screen</dt>
                  <dd>{Math.round(perf.refreshHz)} Hz</dd>
                  <dt>Frame gap</dt>
                  <dd>
                    {perf.avgMs.toFixed(1)} ms avg · {perf.worstMs.toFixed(1)} max
                  </dd>
                  <dt>Draw (CPU)</dt>
                  <dd>
                    {perf.workAvgMs.toFixed(1)} ms avg · {perf.workMaxMs.toFixed(1)} max
                  </dd>
                  <dt>Late frames</dt>
                  <dd>{perf.late} in the last second</dd>
                  <dt>{settings.fps} fps video</dt>
                  {/* A take draws a frame for every tick: settings.fps frames a second, each from its own draw. */}
                  <dd className={perf.workAvgMs * settings.fps <= 800 ? undefined : 'status-error'}>
                    {perf.workAvgMs * settings.fps <= 800
                      ? 'Keeps up'
                      : 'Slow: a take runs behind the clock (the video stays smooth)'}
                  </dd>
                </dl>
              ) : (
                <p className="field-hint">Measuring…</p>
              )}
              <p className="field-hint">
                Over the last second. Draw time is the page's own work per frame; the GPU's comes after it and shows in
                the frame gap. Paint while you watch: an idle canvas is cheap.
              </p>
            </Section>
          </aside>
        )}

        <main className="stage" data-transparent={settings.transparent || undefined}>
          {glError ? (
            <p className="font-warning">{glError}</p>
          ) : (
            <div
              className="stage-frame"
              style={{
                aspectRatio: `${size.width} / ${size.height}`,
                width: `min(100cqw, ${(size.width / size.height).toFixed(4)} * 100cqh)`,
              }}
            >
              <canvas
                ref={canvasRef}
                className="acid-canvas"
                aria-label="Canvas: paint with the brush to turn A into B"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  onPointer(e)
                }}
                onPointerMove={onPointer}
                onPointerUp={onPointer}
                onPointerLeave={() => {
                  engineRef.current?.pointerLeave()
                  setCursor(null)
                }}
              />
              {cursor && (
                <span
                  className="brush-cursor"
                  aria-hidden="true"
                  style={{ left: cursor.x, top: cursor.y, width: cursor.r * 2, height: cursor.r * 2 }}
                />
              )}
            </div>
          )}
        </main>
      </div>

      <footer className="status-bar">
        <span>
          {size.width} × {size.height}
        </span>
        <span>{stats.fps.toFixed(0)} fps</span>
        <span>{stats.morphed} glyphs morphed</span>
        {stats.auto && <span>Auto brush</span>}
        {record.kind === 'idle' && record.message && (
          <span className={record.tone === 'error' ? 'status-error' : undefined}>{record.message}</span>
        )}
        {record.kind === 'saving' && <span>Saving video…</span>}
      </footer>

      <GoogleFontsDialog
        open={google !== null}
        onClose={() => setGoogle(null)}
        onLoad={(request: GoogleFontRequest) => google && loadChoice(google, { kind: 'google', request })}
      />
    </div>
  )
}
