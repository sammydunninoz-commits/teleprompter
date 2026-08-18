import { useStore } from '../store/useStore'
import { nowMs, offsetAt } from './transport'

/**
 * The single transport command vocabulary.
 *
 * Three surfaces now drive the prompter — the desktop transport bar, the phone
 * remote, and the popped-out display window — and they must all mean the same
 * thing by "back a paragraph" or "faster". Defining the commands once, and
 * applying them through one function, is what keeps them honest: every path
 * ends up calling the same store actions, so every path reaches the talent
 * displays through the existing broadcast with no separate wiring.
 */
export type TransportCommand =
  | { type: 'toggle' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'top' }
  | { type: 'wpm'; wpm: number }
  /** Relative speed change in WPM (arrow keys, ± buttons). */
  | { type: 'wpm-step'; delta: number }
  /** Absolute scroll offset in px. */
  | { type: 'scrub'; offset: number }
  /** Nudge the position by ± px without changing speed. */
  | { type: 'nudge'; delta: number }
  /** Jump to the start of the current paragraph, or the previous one if
   *  already sitting at the top of this one. See DisplayView. */
  | { type: 'prev-paragraph' }
  | { type: 'blackout-toggle' }

/** WPM bounds — shared by the slider, the arrow keys and the phone remote. */
export const WPM_MIN = 40
export const WPM_MAX = 700
/** Fine step for the sliders (drag precision). */
export const WPM_STEP = 5
/** Coarse step for the arrow keys — a keypress is a deliberate, larger nudge. */
export const WPM_KEY_STEP = 50
/** Per-notch step for the mouse-wheel speed control (Imaginary-style). */
export const WPM_WHEEL_STEP = 10

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * Apply a command to the operator's store. Must only be called in the operator
 * window: displays are followers and reach this via the control channel.
 */
export function applyTransportCommand(cmd: TransportCommand): void {
  const s = useStore.getState()
  const current = offsetAt(s.transport, nowMs())

  switch (cmd.type) {
    case 'toggle':
      s.togglePlay(current)
      break
    case 'play':
      if (!s.transport.playing) s.play(current)
      break
    case 'pause':
      if (s.transport.playing) s.pause(current)
      break
    case 'top':
      s.scrubTo(0)
      break
    case 'wpm':
      // Trust nothing off the wire: a malformed value would poison the px/sec
      // conversion and run the scroll away.
      if (Number.isFinite(cmd.wpm)) s.setWpm(clamp(Math.round(cmd.wpm), WPM_MIN, WPM_MAX))
      break
    case 'wpm-step':
      if (Number.isFinite(cmd.delta)) {
        s.setWpm(clamp(Math.round(s.settings.wpm + cmd.delta), WPM_MIN, WPM_MAX))
      }
      break
    case 'scrub':
      if (Number.isFinite(cmd.offset)) s.scrubTo(clamp(cmd.offset, 0, s.maxOffset || cmd.offset))
      break
    case 'nudge':
      if (Number.isFinite(cmd.delta)) {
        s.scrubTo(clamp(current + cmd.delta, 0, s.maxOffset || current + cmd.delta))
      }
      break
    case 'prev-paragraph':
      // Resolved by the authoritative DisplayView, which is the only thing that
      // knows where paragraphs actually sit in pixels.
      window.dispatchEvent(new CustomEvent('autocue:prevpara'))
      break
    case 'blackout-toggle':
      s.blackoutAll(!s.displays.some((d) => d.blackout))
      break
  }
}
