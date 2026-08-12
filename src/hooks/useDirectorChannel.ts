import { useEffect } from 'react'
import { directorChannel } from '../channel/channels'
import { useNotesStore } from '../store/useNotesStore'

/**
 * Operator-only: subscribe to the DIRECTOR channel and record incoming flags.
 * This is the sole path by which flags enter the log, keeping them strictly on
 * the director channel and off anything a talent display subscribes to.
 */
export function useDirectorChannel() {
  useEffect(() => {
    useNotesStore.getState().loadFlags()
    const unsub = directorChannel.subscribe((msg) => {
      if (msg.type === 'flag') useNotesStore.getState().ingestFlag(msg.flag)
    })
    return unsub
  }, [])
}

/** Fire a click-to-jump to a word id (resolved by the operator DisplayView). */
export function jumpToWid(wid: string | null) {
  if (!wid) return
  window.dispatchEvent(new CustomEvent('autocue:jumpwid', { detail: { wid } }))
}
