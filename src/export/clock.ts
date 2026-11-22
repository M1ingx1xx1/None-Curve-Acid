// The recording's clock (kept apart from the encoder so the page loads it without Mediabunny). Pure.

/** Ticks drawn in one screen refresh at most when catching up. */
export const MAX_TICKS_PER_REFRESH = 4

/**
 * How many ticks to draw now, `elapsedMs` into the take with `drawn` ticks done: every tick whose time has come, at
 * most `max`. Pure, for the tests.
 */
export function ticksDue(elapsedMs: number, drawn: number, fps: number, max = MAX_TICKS_PER_REFRESH): number {
  const due = Math.floor((Math.max(0, elapsedMs) * fps) / 1000) + 1 - drawn
  return Math.max(0, Math.min(max, due))
}

/** The time (ms into the take) of tick `tick`. */
export function tickTime(tick: number, fps: number): number {
  return (tick * 1000) / fps
}
