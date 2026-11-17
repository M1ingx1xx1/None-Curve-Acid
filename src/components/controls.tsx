// Small panel controls in None-Curve's look (styles.css .group, .field, .segmented, .switch).

import { useId, type ReactNode } from 'react'
import { EASE_NAMES, easeLabel, type EaseName } from '../acid/easing'

export function Section({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="group" open={open}>
      <summary className="group-summary">{title}</summary>
      <div className="group-body">{children}</div>
    </details>
  )
}

interface SliderProps {
  label: string
  value: number
  range: readonly [number, number, number]
  onChange: (value: number) => void
  format?: (value: number) => string
  hint?: string
  disabled?: boolean
}

export function Slider({ label, value, range, onChange, format, hint, disabled }: SliderProps) {
  const id = useId()
  const [min, max, step] = range
  return (
    <div className="field">
      <div className="field-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{format ? format(value) : value.toFixed(2)}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}

export const percent = (v: number) => `${Math.round(v * 100)}%`

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: readonly { value: T; label: ReactNode; title?: string }[]
  onChange: (value: T) => void
}

export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={o.value === value}
            title={o.title}
            aria-label={typeof o.label === 'string' ? undefined : o.title}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  hint?: string
}) {
  const id = useId()
  return (
    <div className="field">
      <div className="field-toggle">
        <span className="switch">
          <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
          <span className="switch-track" aria-hidden="true" />
        </span>
        <label htmlFor={id}>{label}</label>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const id = useId()
  return (
    <div className="field color-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      <output className="color-hex">{value.toUpperCase()}</output>
    </div>
  )
}

export function EaseSelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: EaseName
  onChange: (v: EaseName) => void
}) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as EaseName)}>
        {EASE_NAMES.map((n) => (
          <option key={n} value={n}>
            {easeLabel(n)}
          </option>
        ))}
      </select>
    </div>
  )
}
