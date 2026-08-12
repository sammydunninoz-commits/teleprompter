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

/**
 * ICE configuration for both ends of the link.
 *
 * STUN only, which is all that is available without an account. STUN lets two
 * peers discover their public address and connect directly — but it CANNOT
 * traverse a symmetric NAT, which is what most corporate wifi and some mobile
 * carriers use. In that case the peers find each other on the broker and then
 * fail to open a data channel, which surfaces as `stage: 'channel'` below.
 *
 * The fix for that is a TURN relay, which needs credentials from a provider
 * (Metered, ExpressTURN and Cloudflare all have free tiers). Drop them in here
 * and both the console and the phone pick them up:
 *
 *   { urls: 'turn:<host>:443?transport=tcp', username: '…', credential: '…' }
 *
 * Port 443 over TCP is the variant most likely to survive a restrictive
 * firewall, so prefer it if the provider offers a choice.
 */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

/**
 * How far the phone got before it failed. Each stage implicates a different
 * layer, so the remote reports this rather than one undifferentiated error:
 *
 *  - `broker`  — never reached the signalling server. Firewall or broker outage;
 *                a TURN relay would NOT help.
 *  - `peer`    — reached the broker, but no console is listening on that code.
 *                Stale QR, or the console ended the session.
 *  - `channel` — found the console but no data channel opened within the
 *                timeout. This is the NAT/firewall case that needs TURN.
 */
export type FailureStage = 'broker' | 'peer' | 'channel'

/** How long to wait for the data channel before calling it a NAT failure. */
export const CHANNEL_TIMEOUT_MS = 20_000
