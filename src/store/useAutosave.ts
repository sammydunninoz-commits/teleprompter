import { useEffect } from 'react'
import { useStore } from './useStore'
import { saveSession } from './session'

const DEBOUNCE_MS = 800

/**
 * Operator-only autosave. Mirrors the working script (doc / name / settings) to
 * localStorage a moment after any change, and flushes immediately if the window
 * is closing — so a reload or crash resumes where it left off instead of a blank
 * editor. Restore happens at store-creation time (see session.ts).
 *
 * Only mounted in the operator App, so it never runs on a talent-display window.
 */
export function useAutosave(): void {
  useEffect(() => {
    let timer: number | undefined
    const flush = () => {
      const s = useStore.getState()
      saveSession({
        projectId: s.projectId,
        projectName: s.projectName,
        doc: s.doc,
        settings: s.settings,
        savedAt: Date.now(),
      })
    }
    const unsub = useStore.subscribe((s, prev) => {
      if (
        s.doc !== prev.doc ||
        s.projectName !== prev.projectName ||
        s.projectId !== prev.projectId ||
        s.settings !== prev.settings
      ) {
        window.clearTimeout(timer)
        timer = window.setTimeout(flush, DEBOUNCE_MS)
      }
    })
    // Don't lose an edit made within the debounce window if the tab is closed.
    window.addEventListener('beforeunload', flush)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('beforeunload', flush)
      unsub()
    }
  }, [])
}
