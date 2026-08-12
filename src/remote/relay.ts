import { topicsFor, type RelayRole } from './protocol'

/**
 * The phone-remote transport: a relay over MQTT-on-WebSocket-Secure.
 *
 * This replaced a WebRTC (PeerJS) link, which could not be made reliable for
 * the actual use case. WebRTC needs the two devices to open a direct path to
 * each other, and on a corporate wifi — symmetric NAT — that path does not
 * exist without a TURN relay, which no longer has a free no-signup provider.
 * iOS Safari additionally has long-standing data-channel bugs. A relay sidesteps
 * all of it: both ends make an ordinary outbound TLS connection on port 443,
 * which is the one thing every network and browser permits.
 *
 * The cost is that commands pass through a third-party broker, so we do not
 * trust it: every payload is encrypted under a key derived from the pairing
 * code, which only ever travels in the QR. The broker — and anyone subscribed
 * to a wildcard topic on a public broker — sees nothing but ciphertext, and
 * cannot forge a command because AES-GCM authenticates as well as encrypts.
 */

/**
 * Public brokers, tried in this order.
 *
 * There is a list rather than one entry because the first broker chosen for
 * this feature (mqtt.eclipseprojects.io) turned out to be dead — it resolved,
 * refused TCP, and would have stranded every session. No public broker serves
 * MQTT on 443, so these are all on odd ports; that is survivable because the
 * console publishes its winner into the QR, and the phone joins the same one.
 *
 * Ordered by measured connect time.
 */
export const BROKERS = [
  { id: 'emqx', url: 'wss://broker.emqx.io:8084/mqtt' },
  { id: 'mosq', url: 'wss://test.mosquitto.org:8081/mqtt' },
  { id: 'hive', url: 'wss://broker.hivemq.com:8884/mqtt' },
] as const

export type BrokerId = (typeof BROKERS)[number]['id']

/** How long one broker gets to complete a connection before we try the next. */
const CONNECT_TIMEOUT_MS = 8_000

/**
 * Key stretching. The pairing code is short enough to read off a screen, so it
 * is low-entropy by design; PBKDF2 makes an offline guess against captured
 * ciphertext expensive rather than instant.
 */
const PBKDF2_ITERATIONS = 150_000
const SALT = new TextEncoder().encode('autocue-remote-v1')

async function deriveKey(code: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(code),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Payloads are base64 text rather than raw bytes: mqtt.js expects a Buffer for
 * binary publishes, and Buffer is a Node global we would otherwise have to
 * polyfill into the browser bundle for no benefit.
 */
async function seal(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  // iv ‖ ciphertext — the iv is not secret, only single-use.
  const out = new Uint8Array(iv.length + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), iv.length)
  let bin = ''
  for (const b of out) bin += String.fromCharCode(b)
  return btoa(bin)
}

async function open<T>(key: CryptoKey, text: string): Promise<T | null> {
  try {
    const bin = atob(text)
    if (bin.length < 13) return null
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, 12) },
      key,
      bytes.subarray(12),
    )
    return JSON.parse(new TextDecoder().decode(pt)) as T
  } catch {
    // Wrong key, corrupt payload, or another session's traffic on a shared
    // broker. All three mean "not for us", so drop it silently.
    return null
  }
}

export interface RelayLink<TIn> {
  send: (msg: unknown) => void
  close: () => void
  onMessage: (h: (msg: TIn) => void) => void
  /** Which broker this link actually landed on. Goes into the QR. */
  brokerId: BrokerId
}

/**
 * Connect to the relay for one pairing code.
 *
 * `role` decides the direction: the console listens on the command topic and
 * publishes state; the remote does the reverse. Two topics rather than one
 * keeps a device from receiving its own echo.
 *
 * The console passes no `brokerId` and gets whichever broker answers first; the
 * remote passes the id from the QR so both ends meet on the same one.
 */
export async function connectRelay<TIn>(
  code: string,
  role: RelayRole,
  brokerId?: BrokerId,
): Promise<RelayLink<TIn>> {
  const [{ default: mqtt }, key] = await Promise.all([import('mqtt'), deriveKey(code)])
  const topics = topicsFor(code)
  const listen = role === 'console' ? topics.command : topics.state
  const publish = role === 'console' ? topics.state : topics.command

  const candidates = brokerId ? BROKERS.filter((b) => b.id === brokerId) : BROKERS
  if (!candidates.length) throw new Error(`Unknown relay “${brokerId}”`)

  let lastError = 'no broker reachable'
  for (const broker of candidates) {
    const client = mqtt.connect(broker.url, {
      // A random id: a collision would kick the other client off.
      clientId: `autocue-${role}-${Math.random().toString(36).slice(2, 10)}`,
      clean: true,
      reconnectPeriod: 2000,
      connectTimeout: CONNECT_TIMEOUT_MS,
    })

    let handler: ((msg: TIn) => void) | null = null
    client.on('message', async (_topic: string, payload: Uint8Array) => {
      const msg = await open<TIn>(key, new TextDecoder().decode(payload))
      if (msg && handler) handler(msg)
    })

    const connected = await new Promise<boolean>((resolve) => {
      let settled = false
      const done = (ok: boolean) => {
        if (settled) return
        settled = true
        resolve(ok)
      }
      client.once('connect', () => {
        client.subscribe(listen, { qos: 0 }, (err) => {
          if (err) lastError = err.message
          done(!err)
        })
      })
      client.once('error', (err) => {
        lastError = err.message
        done(false)
      })
      // connectTimeout only governs the MQTT handshake; this covers a socket
      // that opens and then says nothing at all.
      setTimeout(() => {
        lastError = `${broker.id} timed out`
        done(false)
      }, CONNECT_TIMEOUT_MS + 2000)
    })

    if (!connected) {
      client.end(true)
      continue
    }

    return {
      brokerId: broker.id,
      onMessage: (h) => {
        handler = h
      },
      send: (msg) => {
        // Fire-and-forget: QoS 0 is right for transport state, where a newer
        // message supersedes a lost one 250ms later anyway.
        void seal(key, msg).then((text) => {
          if (client.connected) client.publish(publish, text, { qos: 0 })
        })
      },
      close: () => {
        handler = null
        client.end(true)
      },
    }
  }

  throw new Error(lastError)
}
