import { useEffect } from 'react'
import { talentChannel } from '../channel/channels'
import { useStore } from '../store/useStore'

/**
 * Operator side of multi-window sync. When a freshly-opened display window
 * announces itself (request-state / hello), push the full current state so it
 * catches up immediately, then stays in sync via the incremental broadcasts.
 */
export function useOperatorBroadcaster() {
  useEffect(() => {
    const unsub = talentChannel.subscribe((msg) => {
      if (msg.type === 'request-state' || msg.type === 'hello') {
        useStore.getState().broadcastFullState()
      }
    })
    return unsub
  }, [])
}
