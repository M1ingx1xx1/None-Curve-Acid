// The gradient's colour stops: drag a handle along the bar to move it, click the bar to add one, pick a handle to
// change its colour or remove it; Reverse turns the list round; presets replace it.

import { useRef, useState } from 'react'
import { gradientAt, reverseStops } from '../acid/gradient'
import { PRESETS, STOP_LIMITS, type GradientStop } from '../state/settings'
import Icon from './Icon'

const css = (stops: readonly GradientStop[]) =>
  `linear-gradient(90deg, ${stops.map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`).join(', ')})`

const toHex = (rgb: readonly number[]) =>
  `#${rgb
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

export default function StopsEditor({
  stops,
  onChange,
}: {
  stops: GradientStop[]
  onChange: (stops: GradientStop[]) => void
}) {
  const bar = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState(0)
  const drag = useRef<number | null>(null)
  const sel = Math.min(selected, stops.length - 1)

  const posAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }
  /** Sorted, with the stop at `index` still selected. */
  const commit = (next: GradientStop[], index: number) => {
    const moved = next[index]
    const sorted = [...next].sort((a, b) => a.pos - b.pos)
    onChange(sorted)
    setSelected(sorted.indexOf(moved))
  }

  return (
    <div className="field stops">
      <span className="field-label">Colour stops</span>
      <div
        ref={bar}
        className="stops-bar"
        style={{ background: css(stops) }}
        onPointerDown={(e) => {
          if (e.target !== bar.current || stops.length >= STOP_LIMITS.max) return
          const pos = posAt(e.clientX)
          commit([...stops, { color: toHex(gradientAt(stops, pos)), pos }], stops.length)
        }}
        title="Click to add a stop"
      >
        {stops.map((s, i) => (
          <button
            key={i}
            type="button"
            className="stop-handle"
            aria-pressed={i === sel}
            aria-label={`Stop ${i + 1}, ${s.color} at ${Math.round(s.pos * 100)}%`}
            style={{ left: `${s.pos * 100}%`, background: s.color }}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
              drag.current = i
              setSelected(i)
            }}
            onPointerMove={(e) => {
              if (drag.current !== i) return
              onChange(stops.map((t, k) => (k === i ? { ...t, pos: posAt(e.clientX) } : t)))
            }}
            onPointerUp={() => {
              if (drag.current === i) commit(stops, i)
              drag.current = null
            }}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowLeft' ? -0.01 : e.key === 'ArrowRight' ? 0.01 : 0
              if (!d) return
              e.preventDefault()
              commit(
                stops.map((t, k) => (k === i ? { ...t, pos: Math.min(1, Math.max(0, t.pos + d)) } : t)),
                i,
              )
            }}
          />
        ))}
      </div>
      <div className="stops-row">
        <input
          type="color"
          aria-label="Selected stop colour"
          value={stops[sel].color}
          onChange={(e) => onChange(stops.map((t, k) => (k === sel ? { ...t, color: e.target.value } : t)))}
        />
        <output className="color-hex">
          {stops[sel].color.toUpperCase()} · {Math.round(stops[sel].pos * 100)}%
        </output>
        <button
          type="button"
          className="button-small icon-button"
          aria-label="Add stop"
          disabled={stops.length >= STOP_LIMITS.max}
          onClick={() => {
            const next = stops[sel + 1] ?? stops[sel - 1]
            const pos = (stops[sel].pos + next.pos) / 2
            commit([...stops, { color: toHex(gradientAt(stops, pos)), pos }], stops.length)
          }}
        >
          <Icon name="add" />
        </button>
        <button
          type="button"
          className="button-small icon-button"
          aria-label="Remove stop"
          disabled={stops.length <= STOP_LIMITS.min}
          onClick={() => {
            onChange(stops.filter((_, k) => k !== sel))
            setSelected(Math.max(0, sel - 1))
          }}
        >
          <Icon name="close" />
        </button>
        <button type="button" className="button-small" onClick={() => onChange(reverseStops(stops))}>
          <Icon name="swap" />
          Reverse
        </button>
      </div>
      <div className="presets" role="group" aria-label="Presets">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            className="preset"
            onClick={() => {
              onChange(p.stops.map((s) => ({ ...s })))
              setSelected(0)
            }}
          >
            <span className="preset-swatch" style={{ background: css(p.stops) }} aria-hidden="true" />
            {p.name}
          </button>
        ))}
      </div>
    </div>
  )
}
