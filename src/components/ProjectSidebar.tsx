import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { listProjects, deleteProject, saveLink, getLink, deleteLink } from '../store/db'
import { importFile } from '../io/import'
import { importProjectJson } from '../io/projectFile'
import {
  supportsFileSystemAccess,
  pickLinkedDoc,
  readLinkedDocHtml,
} from '../io/liveDoc'
import { flash } from '../lib/flash'
import type { Project } from '../store/types'

/**
 * Collapsible left sidebar holding all project actions and the saved-project
 * library: New (blank project), Open (import any file), Save (store current to
 * the library), plus export options and a clickable list of saved projects.
 */
export default function ProjectSidebar({
  open,
  onToggle,
}: {
  open: boolean
  onToggle: () => void
}) {
  const projectName = useStore((s) => s.projectName)
  const setProjectName = useStore((s) => s.setProjectName)
  const persist = useStore((s) => s.persist)
  const newProject = useStore((s) => s.newProject)
  const loadProjectIntoState = useStore((s) => s.loadProjectIntoState)
  const setMode = useStore((s) => s.setMode)
  const projectId = useStore((s) => s.projectId)
  const linkedDoc = useStore((s) => s.linkedDoc)
  const setLinkedDoc = useStore((s) => s.setLinkedDoc)

  const [projects, setProjects] = useState<Project[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const relinkRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    setProjects(await listProjects())
  }
  useEffect(() => {
    if (open) refresh()
  }, [open])

  // Load the live-document link for the current project into the store.
  useEffect(() => {
    let cancelled = false
    getLink(projectId).then((link) => {
      if (cancelled) return
      setLinkedDoc(
        link ? { name: link.name, handle: link.handle, refreshedAt: link.refreshedAt } : null,
      )
    })
    return () => {
      cancelled = true
    }
  }, [projectId, setLinkedDoc])

  function reloadEditor(html?: string, detectQuestions?: boolean) {
    window.dispatchEvent(
      new CustomEvent('autocue:setcontent', {
        detail: html != null ? { html, detectQuestions } : {},
      }),
    )
  }

  function onNew() {
    if (!confirm('Start a new blank project? Unsaved changes to the current one will be lost.'))
      return
    newProject()
    reloadEditor()
    setMode('edit')
    flash('New project')
  }

  async function onSave() {
    await persist()
    await refresh()
    flash('Saved to library')
  }

  async function onOpenFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const name = file.name.toLowerCase()
    try {
      if (name.endsWith('.json')) {
        const p = await importProjectJson(file)
        loadProjectIntoState(p)
        reloadEditor()
        flash('Project loaded')
      } else {
        setMode('edit')
        const html = await importFile(file)
        reloadEditor(html, true)
      }
    } catch (err) {
      alert(`Open failed: ${(err as Error).message}`)
    } finally {
      e.target.value = ''
    }
  }

  function openFromLibrary(p: Project) {
    loadProjectIntoState(p)
    reloadEditor()
    setMode('edit')
    flash(`Opened “${p.name}”`)
  }

  async function removeFromLibrary(id: string) {
    await deleteProject(id)
    refresh()
  }

  // --- Live document linking ---

  // Warn before replacing the script if it has in-app edits since the last sync.
  // Returns true to proceed. `syncedDoc` undefined means "unknown" (e.g. link
  // reloaded from Dexie after a reload) — we can't tell, so we don't nag.
  function confirmDiscardIfDirty(syncedDoc: string | undefined, action: string): boolean {
    if (!syncedDoc) return true
    const current = JSON.stringify(useStore.getState().doc)
    if (current === syncedDoc) return true
    return confirm(
      `The teleprompter script has edits that aren’t in the linked document.\n\n${action} will replace them with the document’s current contents. Continue?`,
    )
  }

  // Pick a source doc once, import it, and remember the handle for later refreshes.
  async function onLinkDoc() {
    try {
      const ref = await pickLinkedDoc()
      if (!ref) return
      const html = await readLinkedDocHtml(ref.handle)
      setMode('edit')
      reloadEditor(html, true)
      const now = Date.now()
      const syncedDoc = JSON.stringify(useStore.getState().doc)
      await saveLink({
        projectId,
        name: ref.name,
        handle: ref.handle,
        linkedAt: now,
        refreshedAt: now,
      })
      setLinkedDoc({ name: ref.name, handle: ref.handle, refreshedAt: now, syncedDoc })
      flash(`Linked “${ref.name}”`)
    } catch (err) {
      alert(`Link failed: ${(err as Error).message}`)
    }
  }

  // Re-read the linked file from disk and replace the script with its contents.
  async function onRefreshDoc() {
    if (!linkedDoc) return
    if (!confirmDiscardIfDirty(linkedDoc.syncedDoc, 'Refreshing')) return
    setRefreshing(true)
    try {
      const html = await readLinkedDocHtml(linkedDoc.handle)
      setMode('edit')
      reloadEditor(html, true)
      const now = Date.now()
      const syncedDoc = JSON.stringify(useStore.getState().doc)
      // Preserve the original link time; only refreshedAt advances.
      const existing = await getLink(projectId)
      await saveLink({
        projectId,
        name: linkedDoc.name,
        handle: linkedDoc.handle,
        linkedAt: existing?.linkedAt ?? now,
        refreshedAt: now,
      })
      setLinkedDoc({
        name: linkedDoc.name,
        handle: linkedDoc.handle,
        refreshedAt: now,
        syncedDoc,
      })
      flash(`Refreshed from “${linkedDoc.name}”`)
    } catch (err) {
      alert(`Refresh failed: ${(err as Error).message}`)
    } finally {
      setRefreshing(false)
    }
  }

  async function onUnlinkDoc() {
    await deleteLink(projectId)
    setLinkedDoc(null)
    flash('Live document unlinked')
  }

  // Fallback for browsers without the File System Access API: refresh by
  // re-picking the file each time (no persistent handle available).
  async function onRelinkFallback(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setMode('edit')
      const html = await importFile(file)
      reloadEditor(html, true)
      flash(`Refreshed from “${file.name}”`)
    } catch (err) {
      alert(`Refresh failed: ${(err as Error).message}`)
    } finally {
      e.target.value = ''
    }
  }

  // --- Collapsed rail ---
  if (!open) {
    return (
      <div className="flex w-11 flex-col items-center border-r border-edge bg-panelalt py-3">
        <button
          onClick={onToggle}
          title="Open projects"
          className="flex h-8 w-8 items-center justify-center rounded text-lg text-neutral-300 hover:bg-edge"
        >
          »
        </button>
      </div>
    )
  }

  // --- Expanded panel ---
  return (
    <div className="thin-scroll flex w-64 flex-col gap-3 overflow-auto border-r border-edge bg-panelalt p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Projects</h2>
        <button
          onClick={onToggle}
          title="Collapse"
          className="rounded px-2 py-0.5 text-neutral-400 hover:bg-edge"
        >
          «
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-500">Project name</span>
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          className="rounded border border-edge bg-panel px-2 py-1 text-sm"
        />
      </label>

      <div className="grid grid-cols-3 gap-2">
        <ActionBtn onClick={onNew} label="New" />
        <ActionBtn onClick={() => fileRef.current?.click()} label="Open" />
        <ActionBtn onClick={onSave} label="Save" primary />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.docx,.pdf,.txt,.md,.markdown"
        className="hidden"
        onChange={onOpenFile}
      />

      {/* Live document */}
      <div className="mt-1 flex flex-col gap-2 rounded border border-edge bg-panel p-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Live document
          </h3>
          {linkedDoc && (
            <button
              onClick={onUnlinkDoc}
              title="Unlink"
              className="rounded px-1 text-xs text-neutral-500 hover:bg-edge"
            >
              Unlink
            </button>
          )}
        </div>

        {!linkedDoc ? (
          <>
            <button
              onClick={supportsFileSystemAccess ? onLinkDoc : () => relinkRef.current?.click()}
              className="rounded border border-edge px-2 py-1.5 text-sm hover:bg-edge"
            >
              Link Word doc…
            </button>
            <p className="text-[10px] leading-snug text-neutral-500">
              {supportsFileSystemAccess
                ? 'Link a .docx and hit Refresh anytime to pull the latest edits.'
                : 'Your browser can’t hold a live link — Refresh will re-pick the file. Use Chrome or Edge for one-click refresh.'}
            </p>
          </>
        ) : (
          <>
            <div className="truncate text-sm" title={linkedDoc.name}>
              📄 {linkedDoc.name}
            </div>
            <button
              onClick={onRefreshDoc}
              disabled={refreshing}
              className="flex items-center justify-center gap-1 rounded bg-accent px-2 py-1.5 text-sm text-white hover:brightness-110 disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : '⟳ Refresh from doc'}
            </button>
            <p className="text-[10px] text-neutral-500">
              {linkedDoc.refreshedAt
                ? `Last refreshed ${new Date(linkedDoc.refreshedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}`
                : 'Not refreshed yet'}
              {' · replaces the script with the doc’s current text.'}
            </p>
          </>
        )}
      </div>
      <input
        ref={relinkRef}
        type="file"
        accept=".docx,.pdf,.txt,.md,.markdown"
        className="hidden"
        onChange={onRelinkFallback}
      />

      {/* Library */}
      <div className="mt-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Library</h3>
        <button onClick={refresh} title="Refresh" className="rounded px-1 text-xs text-neutral-500 hover:bg-edge">
          ⟳
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {projects.length === 0 && (
          <p className="py-2 text-xs text-neutral-500">
            No saved projects yet. Use <b>Save</b> to store the current script.
          </p>
        )}
        {projects.map((p) => (
          <div
            key={p.id}
            className={`group flex items-center justify-between gap-2 rounded px-2 py-1.5 ${
              p.id === projectId ? 'bg-accent/20' : 'bg-panel'
            }`}
          >
            <button onClick={() => openFromLibrary(p)} className="min-w-0 flex-1 text-left">
              <div className="truncate text-sm">{p.name}</div>
              <div className="text-[10px] text-neutral-500">
                {new Date(p.updatedAt).toLocaleDateString()}{' '}
                {new Date(p.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </button>
            <button
              onClick={() => removeFromLibrary(p.id)}
              title="Delete"
              className="rounded px-1 text-neutral-500 opacity-0 hover:bg-edge group-hover:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ActionBtn({
  label,
  onClick,
  primary,
}: {
  label: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-2 py-1.5 text-sm ${
        primary ? 'bg-accent text-white hover:brightness-110' : 'border border-edge hover:bg-edge'
      }`}
    >
      {label}
    </button>
  )
}
