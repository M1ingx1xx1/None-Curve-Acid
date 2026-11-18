// Undo and redo over whole values (the settings). A change is committed once it has settled, so a slider drag or a
// burst of typing is one step; undo before a change settles reverts just that change. Pure: no React, no DOM.

export class History<T> {
  private past: T[] = []
  private future: T[] = []
  /** The value the last step ended on. */
  private committed: T
  readonly limit: number

  constructor(initial: T, limit = 200) {
    this.committed = initial
    this.limit = limit
  }

  /** Records `value` as a step of its own (when it differs from the last one); clears what could be redone. */
  commit(value: T): void {
    if (value === this.committed) return
    this.past.push(this.committed)
    if (this.past.length > this.limit) this.past.shift()
    this.committed = value
    this.future = []
  }

  /** The value to go back to from `current`, or null when there is none. */
  undo(current: T): T | null {
    if (current !== this.committed) {
      // A change not committed yet: drop it.
      this.future.push(current)
      return this.committed
    }
    const prev = this.past.pop()
    if (prev === undefined) return null
    this.future.push(current)
    this.committed = prev
    return prev
  }

  /** The value to go forward to from `current`, or null when there is none. */
  redo(current: T): T | null {
    if (current !== this.committed) {
      this.commit(current)
      return null
    }
    const next = this.future.pop()
    if (next === undefined) return null
    this.past.push(current)
    this.committed = next
    return next
  }
}
