import { useEffect } from 'react'

/**
 * Keep the display awake mid-take (PWA requirement). Re-acquires the lock when
 * the tab regains visibility, since the browser releases it on tab switch.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false

    async function acquire() {
      try {
        if ('wakeLock' in navigator) {
          lock = await navigator.wakeLock.request('screen')
        }
      } catch {
        /* denied or unsupported — non-fatal */
      }
    }

    function onVisible() {
      if (document.visibilityState === 'visible' && !cancelled) acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      lock?.release().catch(() => {})
    }
  }, [active])
}
