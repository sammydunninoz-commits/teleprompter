/**
 * Stale-bundle recovery.
 *
 * This app is a PWA whose service worker precaches the app shell. After a
 * deploy, a browser can still be running the PREVIOUS index chunk while the
 * server has already deleted the hashed chunks that build referenced. The next
 * lazy import — the phone remote, the QR renderer, the .docx exporter — then
 * fails with "Failed to fetch dynamically imported module", and the feature
 * looks broken even though the deploy was fine.
 *
 * That is exactly what happened when the remote moved off PeerJS: the old shell
 * kept asking for a peerjs chunk that no longer existed. Refreshing fixes it,
 * but nobody should have to know that mid-shoot, so recovery is automatic.
 */

/** Survives the reload, so a persistent failure can't become a reload loop. */
const RELOAD_FLAG = 'autocue:recovered-at'
/** Don't attempt another recovery within this window. */
const RELOAD_COOLDOWN_MS = 60_000

function recentlyRecovered(): boolean {
  const at = Number(sessionStorage.getItem(RELOAD_FLAG) ?? 0)
  return Number.isFinite(at) && Date.now() - at < RELOAD_COOLDOWN_MS
}

/**
 * Drop every cache and reload onto the current deploy. Caches are cleared
 * first: reloading alone would just be handed the same stale shell again.
 */
async function recover(reason: string): Promise<void> {
  if (recentlyRecovered()) {
    console.error(`[autocue] stale bundle (${reason}), but already recovered recently`)
    return
  }
  sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
  console.warn(`[autocue] stale bundle (${reason}) — clearing caches and reloading`)
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    /* best effort — reload regardless */
  }
  window.location.reload()
}

/**
 * Wire up stale-bundle self-healing. Pass `false` for surfaces that must NEVER
 * reload on their own — specifically the talent display, where a reload is a
 * blank screen mid-recording. Those surfaces simply keep running their cached
 * bundle for the whole session; they update only when reopened.
 */
export function installUpdateHandling(enableRecovery = true): void {
  if (!enableRecovery) return

  // Vite raises this when a lazily-imported chunk can't be fetched, which is
  // the precise symptom of a stale shell pointing at a deleted chunk.
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault()
    void recover('chunk fetch failed')
  })

  if (!('serviceWorker' in navigator)) return

  // A new worker taking control means the code running in this page is now a
  // deploy behind. Reload before it tries to import something that's gone.
  // The first claim after install is not an update, so it's skipped.
  let hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) {
      hadController = true
      return
    }
    void recover('new service worker took control')
  })
}
