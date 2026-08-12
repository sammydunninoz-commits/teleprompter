import { useCallback, useEffect, useRef, useState } from 'react'
import type { DataConnection, Peer } from 'peerjs'
import { useStore } from '../store/useStore'
import { estimateRuntimeSec, nowMs, offsetAt } from '../scroll/transport'
import {
  makePairingCode,
  peerIdFor,
  type RemoteCommand,
  type RemoteState,
} from './protocol'

/** How often the console pushes a state snapshot to connected phones. */
const PUSH_INTERVAL_MS = 250
/** Position nudges are clamped to the document, same as the desktop scrubber. */
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export type HostStatus = 'idle' | 'starting' | 'waiting' | 'connected' | 'error'

export interface PeerHostState {
  status: HostStatus
  /** Human-readable pairing code, also embedded in the QR URL. */
  code: string | null
  /** Number of phones currently attached. */
  peers: number
  error: string | null
}

/**
 * Operator side of the phone remote.
 *
 * Owns a PeerJS peer listening on a namespaced pairing code, and applies
 * incoming commands to the ordinary store actions — so a phone press takes
 * exactly the same path as a click on the desktop TransportBar, and therefore
 * reaches the talent displays through the existing broadcast with no extra
 * wiring.
 *
 * peerjs is imported dynamically: it is only needed once the operator actually
 * opens the Remote panel, and keeping it out of the entry chunk matters on a
 * cold load over a venue's wifi.
 */
export function usePeerHost() {
  const [state, setState] = useState<PeerHostState>({
    status: 'idle',
    code: null,
    peers: 0,
    error: null,
  })

  const peerRef = useRef<Peer | null>(null)
  const connsRef = useRef<Set<DataConnection>>(new Set())
  const pushTimerRef = useRef<number | undefined>(undefined)
  /** Guards against a late async start resolving after the component unmounted. */
  const disposedRef = useRef(false)

  /** Apply one phone command through the normal store actions. */
  const applyCommand = useCallback((cmd: RemoteCommand) => {
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
        // Trust nothing off the wire: a malformed value here would poison the
        // px/sec conversion and run the scroll away.
        if (Number.isFinite(cmd.wpm)) s.setWpm(clamp(Math.round(cmd.wpm), 1, 1000))
        break
      case 'scrub':
        if (Number.isFinite(cmd.offset)) {
          s.scrubTo(clamp(cmd.offset, 0, s.maxOffset || cmd.offset))
        }
        break
      case 'nudge':
        if (Number.isFinite(cmd.delta)) {
          s.scrubTo(clamp(current + cmd.delta, 0, s.maxOffset || current + cmd.delta))
        }
        break
    }
  }, [])

  /** Current transport snapshot for the phones. Never includes script text. */
  const snapshot = useCallback((): RemoteState => {
    const s = useStore.getState()
    const offset = offsetAt(s.transport, nowMs())
    const wordsConsumed = Math.max(0, Math.min(s.totalWords, offset * s.wordsPerPx))
    return {
      type: 'state',
      projectName: s.projectName,
      playing: s.transport.playing,
      wpm: s.settings.wpm,
      offset,
      maxOffset: s.maxOffset,
      remainingSec: estimateRuntimeSec(Math.max(0, s.totalWords - wordsConsumed), s.settings.wpm),
      totalSec: estimateRuntimeSec(s.totalWords, s.settings.wpm),
      totalWords: s.totalWords,
    }
  }, [])

  const stop = useCallback(() => {
    if (pushTimerRef.current) window.clearInterval(pushTimerRef.current)
    pushTimerRef.current = undefined
    connsRef.current.forEach((c) => c.close())
    connsRef.current.clear()
    peerRef.current?.destroy()
    peerRef.current = null
    setState({ status: 'idle', code: null, peers: 0, error: null })
  }, [])

  const start = useCallback(async () => {
    if (peerRef.current) return
    setState({ status: 'starting', code: null, peers: 0, error: null })

    const code = makePairingCode()
    try {
      const { default: PeerCtor } = await import('peerjs')
      if (disposedRef.current) return
      const peer = new PeerCtor(peerIdFor(code))
      peerRef.current = peer

      peer.on('open', () => {
        setState((s) => ({ ...s, status: 'waiting', code }))
      })

      peer.on('connection', (conn) => {
        connsRef.current.add(conn)
        conn.on('data', (data) => applyCommand(data as RemoteCommand))
        conn.on('open', () => {
          setState((s) => ({ ...s, status: 'connected', peers: connsRef.current.size }))
          // Send one immediately so the phone paints real values rather than
          // placeholders while it waits for the first interval tick.
          try {
            conn.send(snapshot())
          } catch {
            /* connection raced closed; the interval will clean it up */
          }
        })
        const drop = () => {
          connsRef.current.delete(conn)
          setState((s) => ({
            ...s,
            peers: connsRef.current.size,
            status: connsRef.current.size > 0 ? 'connected' : 'waiting',
          }))
        }
        conn.on('close', drop)
        conn.on('error', drop)
      })

      peer.on('error', (err) => {
        setState((s) => ({ ...s, status: 'error', error: err.message }))
      })

      // Push state on a timer rather than on every store change: the transport
      // updates continuously while playing, and the phone only needs enough
      // resolution to keep a progress bar honest.
      pushTimerRef.current = window.setInterval(() => {
        if (connsRef.current.size === 0) return
        const snap = snapshot()
        connsRef.current.forEach((c) => {
          if (!c.open) return
          try {
            c.send(snap)
          } catch {
            /* transient send failure; next tick retries */
          }
        })
      }, PUSH_INTERVAL_MS)
    } catch (e) {
      setState({ status: 'error', code: null, peers: 0, error: (e as Error).message })
    }
  }, [applyCommand, snapshot])

  // Tear the peer down on unmount so a stale session can't keep accepting
  // commands after the operator has left Prompt mode.
  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      if (pushTimerRef.current) window.clearInterval(pushTimerRef.current)
      connsRef.current.forEach((c) => c.close())
      connsRef.current.clear()
      peerRef.current?.destroy()
      peerRef.current = null
    }
  }, [])

  return { state, start, stop }
}

/** The URL a phone should open to control this session. */
export function remoteUrlFor(code: string): string {
  const u = new URL(window.location.href)
  u.search = `?remote=${encodeURIComponent(code)}`
  u.hash = ''
  return u.toString()
}
