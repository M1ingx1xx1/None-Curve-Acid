import { describe, expect, it } from 'vitest'
import { History } from '../src/state/history'

describe('History', () => {
  it('undoes and redoes committed steps in order', () => {
    const h = new History('a')
    h.commit('b')
    h.commit('c')
    expect(h.undo('c')).toBe('b')
    expect(h.undo('b')).toBe('a')
    expect(h.undo('a')).toBeNull()
    expect(h.redo('a')).toBe('b')
    expect(h.redo('b')).toBe('c')
    expect(h.redo('c')).toBeNull()
  })

  it('drops a change not committed yet, and redo brings it back', () => {
    const h = new History('a')
    h.commit('b')
    expect(h.undo('b-typing')).toBe('b')
    expect(h.redo('b')).toBe('b-typing')
    expect(h.undo('b-typing')).toBe('b')
  })

  it('a new step clears what could be redone', () => {
    const h = new History('a')
    h.commit('b')
    h.undo('b')
    h.commit('x')
    expect(h.redo('x')).toBeNull()
    expect(h.undo('x')).toBe('a')
  })
})
