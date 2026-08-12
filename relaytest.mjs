// End-to-end test of the relay: mirrors src/remote/relay.ts exactly, runs a
// fake console and a fake phone against the real public broker, and checks the
// encrypted handshake + command round-trip.
import mqtt from 'mqtt'

const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt'
const PBKDF2_ITERATIONS = 150_000
const SALT = new TextEncoder().encode('autocue-remote-v1')

const topicsFor = (code) => ({
  command: `autocue/v1/${code}/cmd`,
  state: `autocue/v1/${code}/state`,
})

async function deriveKey(code) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}
async function seal(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)))
  const out = new Uint8Array(iv.length + ct.byteLength)
  out.set(iv, 0); out.set(new Uint8Array(ct), iv.length)
  let bin = ''; for (const b of out) bin += String.fromCharCode(b)
  return btoa(bin)
}
async function open(key, text) {
  try {
    const bin = atob(text)
    if (bin.length < 13) return null
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12))
    return JSON.parse(new TextDecoder().decode(pt))
  } catch { return null }
}

const t0 = Date.now()
const code = 'TESTCODE01'
const topics = topicsFor(code)
const key = await deriveKey(code)
console.log(`key derived (${PBKDF2_ITERATIONS} PBKDF2 rounds) in ${Date.now() - t0}ms`)

const connect = (role) => new Promise((res, rej) => {
  const c = mqtt.connect(BROKER_URL, { clientId: `autocue-${role}-${Math.random().toString(36).slice(2, 10)}`, clean: true, connectTimeout: 10_000, reconnectPeriod: 0 })
  c.once('connect', () => res(c)); c.once('error', rej)
  setTimeout(() => rej(new Error(`${role}: connect timed out`)), 12_000)
})

const tConn = Date.now()
const [consoleC, phoneC] = await Promise.all([connect('console'), connect('remote')])
console.log(`both clients connected to broker in ${Date.now() - tConn}ms`)

let gotCommand = null, gotState = null, sawCiphertext = null
const done = { hello: null, state: null, cmd: null }

// Console: listens on cmd, replies with state.
await new Promise((r) => consoleC.subscribe(topics.command, { qos: 0 }, r))
consoleC.on('message', async (_t, payload) => {
  const raw = payload.toString()
  sawCiphertext = raw
  const msg = await open(key, raw)
  if (!msg) return console.log('console: FAILED to decrypt')
  if (msg.type === 'hello') {
    done.hello = Date.now()
    consoleC.publish(topics.state, await seal(key, {
      type: 'state', projectName: 'Test', playing: false, wpm: 150,
      offset: 0, maxOffset: 1000, remainingSec: 60, totalSec: 60, totalWords: 150,
    }))
  } else { gotCommand = msg; done.cmd = Date.now() }
})

// Phone: listens on state.
await new Promise((r) => phoneC.subscribe(topics.state, { qos: 0 }, r))
phoneC.on('message', async (_t, payload) => {
  const msg = await open(key, payload.toString())
  if (msg?.type === 'state') { gotState = msg; done.state = Date.now() }
})

const tHello = Date.now()
phoneC.publish(topics.command, await seal(key, { type: 'hello' }))
await new Promise((r) => setTimeout(r, 2500))
phoneC.publish(topics.command, await seal(key, { type: 'wpm', wpm: 210 }))
await new Promise((r) => setTimeout(r, 2000))

console.log('---')
console.log('hello reached console  :', !!done.hello, done.hello ? `(${done.hello - tHello}ms)` : '')
console.log('state reached phone    :', !!gotState, done.state ? `(${done.state - tHello}ms round trip)` : '')
console.log('command reached console:', JSON.stringify(gotCommand))
console.log('payload on wire is b64 ciphertext, not plaintext:',
  !!sawCiphertext && !sawCiphertext.includes('wpm') && !sawCiphertext.includes('hello'))
console.log('wire sample            :', sawCiphertext?.slice(0, 48) + '…')

// Wrong code must not decrypt — this is what protects a session on a public broker.
const wrong = await deriveKey('WRONGCODE9')
console.log('wrong code decrypts    :', (await open(wrong, sawCiphertext)) !== null, '(must be false)')

consoleC.end(true); phoneC.end(true)
process.exit(0)
