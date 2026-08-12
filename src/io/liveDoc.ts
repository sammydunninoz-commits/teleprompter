/**
 * "Live" document linking. The operator picks a Word doc (or PDF/txt) once via
 * the File System Access API; we keep the returned FileSystemFileHandle and can
 * re-read the file straight from disk whenever they hit Refresh — no re-picking.
 *
 * The handle is structured-cloneable, so it persists in IndexedDB (see db.ts)
 * and survives reloads. Read permission must be (re)granted with a user gesture
 * across sessions — the Refresh/Link click supplies that gesture.
 *
 * Browsers without the API (Firefox/Safari) fall back to re-opening the file
 * picker on each refresh; see ProjectSidebar for that path.
 */
import { importFile } from './import'

// The File System Access permission methods aren't in the standard DOM lib yet.
type PermMode = { mode?: 'read' | 'readwrite' }
interface HandleWithPermissions extends FileSystemFileHandle {
  queryPermission?: (opts?: PermMode) => Promise<PermissionState>
  requestPermission?: (opts?: PermMode) => Promise<PermissionState>
}
interface OpenPickerWindow {
  showOpenFilePicker?: (opts?: {
    multiple?: boolean
    types?: { description?: string; accept: Record<string, string[]> }[]
  }) => Promise<FileSystemFileHandle[]>
}

/** True when this browser can hold a persistent handle to the picked file. */
export const supportsFileSystemAccess =
  typeof window !== 'undefined' &&
  typeof (window as OpenPickerWindow).showOpenFilePicker === 'function'

export interface LinkedDocRef {
  handle: FileSystemFileHandle
  name: string
}

/**
 * Prompt for a document and return a persistent handle to it. Returns null if
 * the picker was dismissed. Throws only on unexpected errors.
 */
export async function pickLinkedDoc(): Promise<LinkedDocRef | null> {
  const picker = (window as OpenPickerWindow).showOpenFilePicker
  if (!picker) throw new Error('This browser cannot link a live document.')
  try {
    const [handle] = await picker({
      multiple: false,
      types: [
        {
          description: 'Script documents',
          accept: {
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
            'application/pdf': ['.pdf'],
            'text/plain': ['.txt'],
            'text/markdown': ['.md', '.markdown'],
          },
        },
      ],
    })
    if (!handle) return null
    return { handle, name: handle.name }
  } catch (err) {
    // The user cancelling the picker rejects with an AbortError — treat as no-op.
    if ((err as DOMException)?.name === 'AbortError') return null
    throw err
  }
}

async function ensureReadPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const h = handle as HandleWithPermissions
  if (!h.queryPermission) return true // Older impls: permission is implicit.
  if ((await h.queryPermission({ mode: 'read' })) === 'granted') return true
  return (await h.requestPermission?.({ mode: 'read' })) === 'granted'
}

/**
 * Re-read the linked file from disk and convert it to import HTML. Must be
 * called from a user gesture the first time each session (for the permission
 * prompt). Throws with a friendly message if permission is denied or the file
 * has moved/been deleted.
 */
export async function readLinkedDocHtml(handle: FileSystemFileHandle): Promise<string> {
  if (!(await ensureReadPermission(handle))) {
    throw new Error('Permission to read the linked file was denied.')
  }
  let file: File
  try {
    file = await handle.getFile()
  } catch {
    throw new Error('The linked file could not be read — it may have been moved, renamed, or deleted.')
  }
  return importFile(file)
}
