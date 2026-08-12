import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { applyTransportCommand } from '../scroll/commands'
import { estimateRuntimeSec, nowMs, offsetAt } from '../scroll/transport'
import { connectRelay, type BrokerId, type RelayLink } from './relay'
import { makePairingCode, type RemoteState, type RemoteUp } from './protocol'

/** How often the console publishes a state snapshot to connected phones. */
const PUSH_INTERVAL_MS = 250
/** A phone is considered attached this long after its last message. */
const PEER_TTL_MS = 8_000

export type HostStatus = 'idle' | 'starting' | 'waiting' | 'connected' | 'error'

export interface RemoteHostState {
  status: HostStatus
  /** Human-readable pairing code, also embedded in the QR URL. */
  code: string | null
  /** Relay the console landed on; the phone must join the same one. */
  brokerId: BrokerId | null
  /** Number of phones seen recently. */
  peers: number
  error: string | null
}

/**
 * Console side of the phone remote.
 *
 * Holds the relay link for one pairing session and applies incoming commands
 * through the ordinary store actions — so a phone press takes exactly the same
 * path as a click on the desktop TransportBar, and therefore reaches the talent
 * displays through the existing broadcast with no extra wiring.
 */
export function useRemoteHost() {
  const [state, setState] = useState<RemoteHostState>({
    status: 'idle',
    code: null,
    brokerId: null,
    peers: 0,
    error: null,
  })

  const linkRef = useRef<RelayLink<RemoteUp> | null>(null)
  const pushTimerRef = useRef<number | undefined>(undefined)
  /** Last time each phone was heard from, so we can age them out. */
  const seenRef = useRef<Map<string, number>>(new Map())
  const disposedRef = useRef(false)

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

  const teardown = useCallback(() => {
    if (pushTimerRef.current) window.clearInterval(pushTimerRef.current)
    pushTimerRef.current = undefined
    linkRef.current?.close()
    linkRef.current = null
    seenRef.current.clear()
  }, [])

  const stop = useCallback(() => {
    teardown()
    setState({ status: 'idle', code: null, brokerId: null, peers: 0, error: null })
  }, [teardown])

  const start = useCallback(async () => {
    if (linkRef.current) return
    setState({ status: 'starting', code: null, brokerId: null, peers: 0, error: null })

    const code = makePairingCode()
    try {
      const link = await connectRelay<RemoteUp>(code, 'console')
      if (disposedRef.current) {
        link.close()
        return
      }
      linkRef.current = link

      link.onMessage((msg) => {
        // Any inbound message proves a phone is alive; `hello` additionally asks
        // for an immediate snapshot so it can paint real values at once rather
        // than waiting for the next interval tick.
        seenRef.current.set('phone', nowMs())
        if (msg.type === 'hello') link.send(snapshot())
        else applyTransportCommand(msg)
      })

      setState({ status: 'waiting', code, brokerId: link.brokerId, peers: 0, error: null })

      pushTimerRef.current = window.setInterval(() => {
        // Age out phones we have not heard from; MQTT has no connection-level
        // signal that a subscriber went away.
        const cutoff = nowMs() - PEER_TTL_MS
        for (const [id, at] of seenRef.current) if (at < cutoff) seenRef.current.delete(id)
        const peers = seenRef.current.size

        setState((s) =>
          s.peers === peers && s.status !== 'starting'
            ? s
            : { ...s, peers, status: peers > 0 ? 'connected' : 'waiting' },
        )
        if (peers > 0) linkRef.current?.send(snapshot())
      }, PUSH_INTERVAL_MS)
    } catch (e) {
      teardown()
      setState({
        status: 'error',
        code: null,
        brokerId: null,
        peers: 0,
        error: (e as Error).message,
      })
    }
  }, [snapshot, teardown])

  // Tear the session down on unmount so a stale code can't keep accepting
  // commands after the operator has left Prompt mode.
  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      teardown()
    }
  }, [teardown])

  return { state, start, stop }
}

/**
 * The URL a phone should open to control this session. The broker id rides
 * along so the phone joins the relay the console actually landed on, rather
 * than re-running the fallback search and possibly picking a different one.
 */
export function remoteUrlFor(code: string, brokerId: BrokerId): string {
  const u = new URL(window.location.href)
  u.search = `?remote=${encodeURIComponent(code)}&b=${encodeURIComponent(brokerId)}`
  u.hash = ''
  return u.toString()
}
