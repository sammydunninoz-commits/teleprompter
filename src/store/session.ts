import type { JSONContent } from '@tiptap/core'
import { DEFAULT_SETTINGS, type ProjectSettings } from './types'
import { nanoid } from 'nanoid'

/**
 * Crash/reload recovery for the operator's working session.
 *
 * Every edit lands in the store; a debounced writer (see App) mirrors the current
 * script to localStorage, and the store restores it on load. So an accidental
 * refresh — or the operator window being reopened — resumes exactly where it left
 * off instead of coming back to a blank editor. Paired with the operator pushing
 * full state on mount, a recovered operator also re-syncs any open talent display.
 *
 * localStorage (not IndexedDB) is deliberate: it's synchronous, so restore happens
 * at store-creation time with no async flash, and a teleprompter script is small.
 */

const KEY = 'autocue:session'

export interface SessionSnapshot {
  projectId: string
  projectName: string
  doc: JSONContent
  settings: ProjectSettings
  savedAt: number
}

/**
 * True only for the operator console. The talent display (`?display=`) and the
 * phone remote (`?remote=`) derive their content from the operator over the
 * channel — they must NEVER restore a local session, or they'd flash stale text.
 */
export function isOperatorSurface(): boolean {
  if (typeof window === 'undefined') return false
  const p = new URLSearchParams(window.location.search)
  return !p.get('display') && !p.get('remote')
}

export function loadSession(): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as SessionSnapshot
    // Validate enough to trust it as an editor document.
    if (!s || !s.projectId || !s.doc || (s.doc as JSONContent).type !== 'doc') return null
    return s
  } catch {
    return null
  }
}

export function saveSession(s: SessionSnapshot): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* quota exceeded / private mode — autosave is best-effort, never fatal */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

/**
 * The project fields the store should start from: the restored session on the
 * operator console, else a fresh blank project. The WPM preset always starts at
 * the default (a standing request) rather than the last session's speed, even on
 * a restore — the script and other settings are preserved.
 */
export function initialProjectState(): {
  projectId: string
  projectName: string
  doc: JSONContent
  settings: ProjectSettings
} {
  const restored = isOperatorSurface() ? loadSession() : null
  return {
    projectId: restored?.projectId ?? nanoid(10),
    projectName: restored?.projectName ?? 'Untitled script',
    doc: restored?.doc ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    settings: { ...DEFAULT_SETTINGS, ...(restored?.settings ?? {}), wpm: DEFAULT_SETTINGS.wpm },
  }
}
