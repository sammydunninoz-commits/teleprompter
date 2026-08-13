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
        if (!('wakeLock' in navigator)) return
        // Release any sentinel we still hold before requesting a new one, so the
        // re-acquire-on-visible path can't leak the previous lock.
        if (lock) {
          const old = lock
          lock = null
          await old.release().catch(() => {})
        }
        const sentinel = await navigator.wakeLock.request('screen')
        // If the effect was torn down while the request was in flight, the cleanup
        // already ran and won't see this sentinel — release it now, don't leak it.
        if (cancelled) {
          sentinel.release().catch(() => {})
          return
        }
        lock = sentinel
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
