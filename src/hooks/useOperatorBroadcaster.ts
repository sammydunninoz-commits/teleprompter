import { useEffect } from 'react'
import { talentChannel } from '../channel/channels'
import { applyTransportCommand } from '../scroll/commands'
import { useStore } from '../store/useStore'

/**
 * Operator side of multi-window sync. When a freshly-opened display window
 * announces itself (request-state / hello), push the full current state so it
 * catches up immediately, then stays in sync via the incremental broadcasts.
 *
 * Also the operator's inbox for control commands sent UP from display windows
 * (see TalentMessage.control) — the operator is the only writer of transport
 * state, so a keypress in a display has to be applied here.
 */
export function useOperatorBroadcaster() {
  useEffect(() => {
    const unsub = talentChannel.subscribe((msg) => {
      if (msg.type === 'request-state' || msg.type === 'hello') {
        useStore.getState().broadcastFullState()
      } else if (msg.type === 'control') {
        applyTransportCommand(msg.cmd)
      }
    })
    return unsub
  }, [])
}
