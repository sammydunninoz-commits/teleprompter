import { useEffect } from 'react'
import { talentChannel } from '../channel/channels'
import { useStore } from '../store/useStore'

/**
 * Runs inside a spawned display window. Subscribes to the TALENT channel and
 * feeds transport / doc / config / live-highlight into this window's own store,
 * WITHOUT re-broadcasting. Position is then derived locally, every frame, from
 * the transport state — so displays stay glued together under frame drops.
 *
 * Note: this window subscribes ONLY to the talent channel. It has no knowledge
 * of the director channel, so stumble notes can never reach it.
 */
export function useTalentReceiver(displayId: string) {
  useEffect(() => {
    let gotConfig = false
    const unsub = talentChannel.subscribe((msg) => {
      // A malformed or unexpected message must never throw here — an uncaught
      // error would bubble into React and take the display down. Ingest is
      // best-effort; a bad frame is dropped, the screen stays up.
      try {
        switch (msg.type) {
          case 'transport':
            useStore.getState().ingestTransport(msg.transport)
            break
          case 'doc':
            useStore.getState().ingestDoc(msg.doc, msg.docVersion)
            break
          case 'display-config':
            if (msg.config.id === displayId) {
              useStore.getState().ingestDisplayConfig(msg.config)
              gotConfig = true
            }
            break
          case 'live-highlight':
            useStore.getState().ingestLiveHighlight(msg.wid)
            break
          default:
            break
        }
      } catch (err) {
        console.error('[autocue] display dropped a bad message:', err)
      }
    })

    // Announce ourselves so the operator pushes the full current state. Because
    // BroadcastChannel doesn't queue, a request sent before the operator has
    // subscribed is lost. We retry until our config arrives — with NO hard cap,
    // so a display opened before the operator (or reopened after one) always
    // catches up rather than giving up and sitting on "Waiting for operator…".
    // Recovery after an operator reload is also covered from the other side:
    // useOperatorBroadcaster pushes full state on mount.
    talentChannel.post({ type: 'request-state', displayId })
    const retry = window.setInterval(() => {
      if (gotConfig) {
        window.clearInterval(retry)
        return
      }
      talentChannel.post({ type: 'request-state', displayId })
    }, 500)

    return () => {
      unsub()
      window.clearInterval(retry)
    }
  }, [displayId])
}
