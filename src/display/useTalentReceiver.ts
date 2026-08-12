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
    })

    // Announce ourselves so the operator pushes the full current state. Because
    // BroadcastChannel doesn't queue, a single request sent before the operator
    // tab has subscribed is lost — leaving this window stuck on "Waiting for
    // operator…". So we retry until our config arrives, then stop. A hard cap
    // prevents an endless poll if no operator is ever present.
    talentChannel.post({ type: 'request-state', displayId })
    const retry = window.setInterval(() => {
      if (gotConfig) {
        window.clearInterval(retry)
        return
      }
      talentChannel.post({ type: 'request-state', displayId })
    }, 500)
    const stopRetry = window.setTimeout(() => window.clearInterval(retry), 30000)

    return () => {
      unsub()
      window.clearInterval(retry)
      window.clearTimeout(stopRetry)
    }
  }, [displayId])
}
