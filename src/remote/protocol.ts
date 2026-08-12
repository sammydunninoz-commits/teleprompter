import type { TransportCommand } from '../scroll/commands'

/**
 * Phone-remote wire protocol (operator console ⇄ handheld remote).
 *
 * Carried over the relay in relay.ts, which is a SEPARATE transport from the
 * BroadcastChannel display sync in channel/channels.ts — that one is
 * same-origin, same-browser only, which is exactly the constraint a second
 * device breaks.
 *
 * Two rules carried over from the display channel:
 *  - The remote is a CONTROLLER, not a display. It receives transport state and
 *    counters only — never the script body, and never director flags.
 *  - We exchange transport STATE, never per-frame position. The phone renders a
 *    progress figure from the state it was last told, the same way displays do.
 */

/**
 * Commands the phone sends — the same vocabulary the transport bar and the
 * display windows use, so all three surfaces stay in step by construction
 * rather than by discipline.
 */
export type RemoteCommand = TransportCommand

/** Everything the phone can publish. `hello` asks for an immediate snapshot. */
export type RemoteUp = RemoteCommand | { type: 'hello' }

/** Snapshot the operator console publishes a few times a second. */
export interface RemoteState {
  type: 'state'
  projectName: string
  playing: boolean
  wpm: number
  /** Current scroll offset (px) and the document's maximum, for the scrubber. */
  offset: number
  maxOffset: number
  /** Estimated seconds left at the current WPM, already computed console-side. */
  remainingSec: number
  totalSec: number
  totalWords: number
}

/** WPM slider bounds — one definition, shared with the desktop TransportBar. */
export { WPM_MIN, WPM_MAX, WPM_STEP } from '../scroll/commands'

/** Which end of the link a client is. Decides publish/subscribe direction. */
export type RelayRole = 'console' | 'remote'

/**
 * The pairing code is the ONLY secret: it names the topic pair and derives the
 * encryption key. The alphabet excludes characters that misread off a screen
 * (0/O, 1/I/L) because it can be typed in when a camera won't focus.
 *
 * Ten characters over 31 symbols ≈ 49 bits. That is deliberately more than a
 * topic name needs, because the same string is stretched into the AES key — see
 * the PBKDF2 note in relay.ts.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LEN = 10

export function makePairingCode(): string {
  const bytes = new Uint8Array(CODE_LEN)
  crypto.getRandomValues(bytes)
  let out = ''
  // The slight modulo bias over a 256→31 fold costs a fraction of a bit and the
  // code lives only as long as the session.
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length]
  return out
}

/**
 * Two topics, so neither end receives its own echo. Namespaced so an autocue
 * session cannot collide with another app on the shared public broker.
 */
export function topicsFor(code: string) {
  return {
    command: `autocue/v1/${code}/cmd`,
    state: `autocue/v1/${code}/state`,
  }
}

/**
 * How far the phone got before it failed. Each stage implicates a different
 * layer, so the remote reports this rather than one undifferentiated error:
 *
 *  - `relay`   — never reached the broker. Firewall, captive portal, or the
 *                public broker being down.
 *  - `console` — reached the broker, but no console answered on that code.
 *                Stale QR, or the session was ended.
 */
export type FailureStage = 'relay' | 'console'

/** How long to wait for the console's first snapshot before giving up. */
export const CONSOLE_TIMEOUT_MS = 12_000

/** Treat the console as gone if no snapshot arrives within this long. */
export const STALE_MS = 4_000
