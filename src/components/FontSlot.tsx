// One font slot (A or B): what is loaded, and the three ways to change it (a file, Google Fonts, a built-in font).

import { useId, useRef } from 'react'
import { errorKindLabel, type FontLoadError } from '../font/errors'
import { BUILTIN_FONTS, type LoadedFont } from '../font/parse'
import Icon from './Icon'

export type SlotState =
  { kind: 'loading'; label: string } | { kind: 'ready'; font: LoadedFont } | { kind: 'error'; error: FontLoadError }

interface FontSlotProps {
  title: string
  hint: string
  state: SlotState
  onFile: (file: File) => void
  onGoogle: () => void
  onBuiltin: (file: string) => void
}

export default function FontSlot({ title, hint, state, onFile, onGoogle, onBuiltin }: FontSlotProps) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const builtin = state.kind === 'ready' && state.font.source.kind === 'builtin' ? state.font.source.file : ''
  return (
    <div
      className="field font-slot"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const file = e.dataTransfer.files[0]
        if (file) onFile(file)
      }}
    >
      <div className="field-head">
        <span className="field-label">{title}</span>
        <span className="file-status" data-state={state.kind}>
          <span className="dot" aria-hidden="true" />
          {state.kind === 'ready' ? state.font.label : state.kind === 'loading' ? `Loading ${state.label}…` : 'Error'}
        </span>
      </div>
      {state.kind === 'error' && (
        <p className="font-warning" role="alert">
          {errorKindLabel[state.error.kind]}: {state.error.message}
        </p>
      )}
      <div className="slot-actions">
        <button type="button" className="button-small" onClick={() => input.current?.click()}>
          <Icon name="upload" />
          File
        </button>
        <input
          ref={input}
          type="file"
          accept=".ttf,.otf,.woff,.woff2,.ttc,.otc,font/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
            e.target.value = ''
          }}
        />
        <button type="button" className="button-small" onClick={onGoogle}>
          Google Fonts
        </button>
        <select
          id={id}
          aria-label={`${title}: built-in font`}
          value={builtin}
          onChange={(e) => e.target.value && onBuiltin(e.target.value)}
        >
          <option value="" disabled>
            Built-in…
          </option>
          {BUILTIN_FONTS.map((f) => (
            <option key={f.file} value={f.file}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      <p className="field-hint">{hint}</p>
    </div>
  )
}
