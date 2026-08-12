import type { TransportState } from '../store/types'

/**
 * Shared, cross-window monotonic-ish clock in epoch milliseconds.
 *
 * performance.now() has a different origin per window, so it can't be compared
 * across windows. Adding performance.timeOrigin yields a high-resolution epoch
 * timestamp every window agrees on — the basis for glued-together playback.
 */
export function nowMs(): number {
  return performance.timeOrigin + performance.now()
}

/**
 * Derive the current scroll offset (px) from transport state alone.
 * Called every animation frame, independently, in each window.
 */
export function offsetAt(t: TransportState, now: number): number {
  if (!t.playing) return t.offsetAtStart
  return t.offsetAtStart + ((now - t.startedAt) / 1000) * t.pxPerSec
}

/** Build a transport state that starts playing from the given offset now. */
export function makePlaying(offsetPx: number, pxPerSec: number, seq: number): TransportState {
  return { playing: true, pxPerSec, startedAt: nowMs(), offsetAtStart: offsetPx, seq }
}

/** Build a paused transport state pinned at the given offset. */
export function makePaused(offsetPx: number, seq: number): TransportState {
  return { playing: false, pxPerSec: 0, startedAt: nowMs(), offsetAtStart: offsetPx, seq }
}

/**
 * Convert a words-per-minute target into pixels-per-second for the current
 * layout. Words-per-pixel is measured from the actually-rendered document so
 * the speed reflects real word density, not an arbitrary scale (Feature 2).
 */
export function wpmToPxPerSec(wpm: number, wordsPerPx: number): number {
  if (wordsPerPx <= 0) return 0
  const wordsPerSec = wpm / 60
  return wordsPerSec / wordsPerPx
}

/** Estimated seconds of runtime remaining given words left and WPM. */
export function estimateRuntimeSec(wordsRemaining: number, wpm: number): number {
  if (wpm <= 0) return 0
  return (wordsRemaining / wpm) * 60
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}
