/**
 * Phone-remote wire protocol (operator console ⇄ handheld remote).
 *
 * This is a SEPARATE transport from the BroadcastChannel display sync in
 * channel/channels.ts, and deliberately so: BroadcastChannel is same-origin,
 * same-browser only, which is exactly the constraint a second device breaks.
 * Here the two ends pair over WebRTC (see peerHost.ts), so the link crosses
 * devices and networks.
 *
 * Two rules carried over from the display channel:
 *  - The remote is a CONTROLLER, not a display. It receives transport state and
 *    counters only — never the script body, and never director flags.
 *  - We exchange transport STATE, never per-frame position. The phone renders a
 *    progress figure from the state it was last told, the same way displays do.
 */

/** Commands the phone sends to the operator console. */
export type RemoteCommand =
  | { type: 'toggle' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'top' }
  | { type: 'wpm'; wpm: number }
  /** Absolute scroll offset in px, as reported by the last `RemoteState`. */
  | { type: 'scrub'; offset: number }
  /** Nudge the position by ± px without changing speed (e.g. after a stumble). */
  | { type: 'nudge'; delta: number }

/** Snapshot the operator console pushes to the phone a few times a second. */
export interface RemoteState {
  type: 'state'
  projectName: string
  playing: boolean
  wpm: number
  /** Current scroll offset (px) and the document's maximum, for the scrubber. */
  offset: number
  maxOffset: number
  /** Estimated seconds left at the current WPM, already computed operator-side. */
  remainingSec: number
  totalSec: number
  totalWords: number
}

export type RemoteMessage = RemoteCommand | RemoteState

/** WPM slider bounds — kept identical to the desktop TransportBar. */
export const WPM_MIN = 40
export const WPM_MAX = 700
export const WPM_STEP = 5

/**
 * PeerJS ids must be a plain token, and this one is read off a phone screen if
 * the QR fails, so the alphabet excludes characters that misread (0/O, 1/I/L).
 * 8 chars over 30 symbols ≈ 39 bits — enough that the pairing code for a
 * short-lived session can't realistically be guessed on the public broker.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LEN = 8

export function makePairingCode(): string {
  const bytes = new Uint8Array(CODE_LEN)
  crypto.getRandomValues(bytes)
  let out = ''
  // Rejection-free mapping is unnecessary here; the slight modulo bias over a
  // 256→31 fold costs a fraction of a bit and the code is single-session.
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out
}

/**
 * Namespace the code before handing it to the shared public PeerJS broker, so
 * an autocue session can never collide with an unrelated app's peer id.
 */
export function peerIdFor(code: string): string {
  return `autocue-remote-${code}`
}
