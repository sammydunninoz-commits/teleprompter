import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { useStore } from '../store/useStore'
import { db, saveLink, getLink, deleteLink } from '../store/db'
import { importFile } from '../io/import'
import { importProjectJson } from '../io/projectFile'
import {
  supportsFileSystemAccess,
  pickLinkedDoc,
  readLinkedDocHtml,
} from '../io/liveDoc'
import { flash } from '../lib/flash'
import { useDialog } from './useDialog'

/**
 * Project actions, living at the right-hand end of the top bar: New, Load
 * Script, Save, Save As and the live-document link.
 *
 * These used to sit in the left sidebar, which now holds the library alone.
 * There is deliberately no project-name field here — a name is only asked for
 * at the two moments one is actually needed (New and Save As), via a dialog.
 * The current name is already shown in the header beside the app title.
 */
export default function ProjectActions({ onLibraryChanged }: { onLibraryChanged: () => void }) {
  const projectId = useStore((s) => s.projectId)
  const persist = useStore((s) => s.persist)
  const newProject = useStore((s) => s.newProject)
  const setProjectName = useStore((s) => s.setProjectName)
  const loadProjectIntoState = useStore((s) => s.loadProjectIntoState)
  const setMode = useStore((s) => s.setMode)
  const linkedDoc = useStore((s) => s.linkedDoc)
  const setLinkedDoc = useStore((s) => s.setLinkedDoc)

  const [refreshing, setRefreshing] = useState(false)
  const [docMenu, setDocMenu] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const relinkRef = useRef<HTMLInputElement>(null)
  const docMenuRef = useRef<HTMLDivElement>(null)
  const { dialog, ask } = useDialog()

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

  // Close the live-document popover on an outside click.
  useEffect(() => {
    if (!docMenu) return
    const onDown = (e: MouseEvent) => {
      if (!docMenuRef.current?.contains(e.target as Node)) setDocMenu(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [docMenu])

  function reloadEditor(html?: string, detectQuestions?: boolean) {
    window.dispatchEvent(
      new CustomEvent('autocue:setcontent', {
        detail: html != null ? { html, detectQuestions } : {},
      }),
    )
  }

  async function onNew() {
    const ok = await ask({
      kind: 'confirm',
      title: 'Start a new script?',
      body: 'Unsaved changes to the current script will be lost.',
      confirmLabel: 'Continue',
      danger: true,
    })
    if (!ok) return

    const name = await ask({
      kind: 'prompt',
      title: 'Name the new script',
      label: 'Script name',
      initial: 'Untitled script',
      confirmLabel: 'Create',
    })
    if (typeof name !== 'string') return

    newProject()
    setProjectName(name)
    reloadEditor()
    setMode('edit')
    flash(`Created “${name}”`)
  }

  /**
   * Save commits to the project already in the library. If this script has
   * never been saved there is nothing to commit to, so it falls through to
   * Save As rather than silently creating an entry the operator didn't name.
   */
  async function onSave() {
    const existing = await db.projects.get(projectId)
    if (!existing) return onSaveAs()
    await persist()
    onLibraryChanged()
    flash('Saved')
  }

  async function onSaveAs() {
    const name = await ask({
      kind: 'prompt',
      title: 'Save as',
      body: 'Saves a copy to the library under a new name.',
      label: 'Script name',
      initial: useStore.getState().projectName,
      confirmLabel: 'Save',
    })
    if (typeof name !== 'string') return

    // A new library entry means a new id — otherwise "Save as" would overwrite
    // the script it was copied from.
    useStore.setState({ projectId: nanoid(10) })
    setProjectName(name)
    await persist()
    onLibraryChanged()
    flash(`Saved “${name}”`)
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
        flash('Script loaded')
      } else {
        setMode('edit')
        const html = await importFile(file)
        reloadEditor(html, true)
        flash(`Loaded “${file.name}”`)
      }
    } catch (err) {
      await ask({
        kind: 'confirm',
        title: 'Couldn’t load that file',
        body: (err as Error).message,
        confirmLabel: 'OK',
      })
    } finally {
      e.target.value = ''
    }
  }

  // --- Live document linking ---

  async function confirmDiscardIfDirty(syncedDoc: string | undefined, action: string) {
    if (!syncedDoc) return true
    const current = JSON.stringify(useStore.getState().doc)
    if (current === syncedDoc) return true
    return !!(await ask({
      kind: 'confirm',
      title: 'Replace the script?',
      body: `The script has edits that aren’t in the linked document. ${action} will replace them with the document’s current contents.`,
      confirmLabel: action,
      danger: true,
    }))
  }

  async function onLinkDoc() {
    try {
      const ref = await pickLinkedDoc()
      if (!ref) return
      const html = await readLinkedDocHtml(ref.handle)
      setMode('edit')
      reloadEditor(html, true)
      const now = Date.now()
      const syncedDoc = JSON.stringify(useStore.getState().doc)
      await saveLink({ projectId, name: ref.name, handle: ref.handle, linkedAt: now, refreshedAt: now })
      setLinkedDoc({ name: ref.name, handle: ref.handle, refreshedAt: now, syncedDoc })
      flash(`Linked “${ref.name}”`)
    } catch (err) {
      flash(`Link failed: ${(err as Error).message}`)
    }
  }

  async function onRefreshDoc() {
    if (!linkedDoc) return
    if (!(await confirmDiscardIfDirty(linkedDoc.syncedDoc, 'Refresh'))) return
    setRefreshing(true)
    try {
      const html = await readLinkedDocHtml(linkedDoc.handle)
      setMode('edit')
      reloadEditor(html, true)
      const now = Date.now()
      const syncedDoc = JSON.stringify(useStore.getState().doc)
      const existing = await getLink(projectId)
      await saveLink({
        projectId,
        name: linkedDoc.name,
        handle: linkedDoc.handle,
        linkedAt: existing?.linkedAt ?? now,
        refreshedAt: now,
      })
      setLinkedDoc({ name: linkedDoc.name, handle: linkedDoc.handle, refreshedAt: now, syncedDoc })
      flash(`Refreshed from “${linkedDoc.name}”`)
    } catch (err) {
      flash(`Refresh failed: ${(err as Error).message}`)
    } finally {
      setRefreshing(false)
    }
  }

  async function onUnlinkDoc() {
    await deleteLink(projectId)
    setLinkedDoc(null)
    setDocMenu(false)
    flash('Live document unlinked')
  }

  async function onRelinkFallback(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setMode('edit')
      const html = await importFile(file)
      reloadEditor(html, true)
      flash(`Refreshed from “${file.name}”`)
    } catch (err) {
      flash(`Refresh failed: ${(err as Error).message}`)
    } finally {
      e.target.value = ''
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <BarBtn onClick={onNew} label="New" title="Start a new blank script" />
      <BarBtn
        onClick={() => fileRef.current?.click()}
        label="Load Script"
        title="Open a .json project, or import .docx / .pdf / .txt / .md"
      />
      <BarBtn onClick={onSave} label="Save" title="Commit changes to this script" primary />
      <BarBtn onClick={onSaveAs} label="Save As" title="Save a copy to the library under a new name" />

      {/* Live document */}
      <div className="relative" ref={docMenuRef}>
        <BarBtn
          onClick={() => setDocMenu((v) => !v)}
          label={linkedDoc ? '📄 Linked' : '📄 Link doc'}
          title="Link a Word document and refresh the script from it"
          active={docMenu}
        />
        {docMenu && (
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded border border-edge bg-panelalt p-3 shadow-xl">
            {!linkedDoc ? (
              <>
                <button
                  onClick={() => {
                    setDocMenu(false)
                    if (supportsFileSystemAccess) onLinkDoc()
                    else relinkRef.current?.click()
                  }}
                  className="w-full rounded border border-edge px-2 py-1.5 text-sm hover:bg-edge"
                >
                  Link Word doc…
                </button>
                <p className="mt-2 text-[10px] leading-snug text-neutral-500">
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
                  className="mt-2 w-full rounded bg-accent px-2 py-1.5 text-sm text-white hover:brightness-110 disabled:opacity-50"
                >
                  {refreshing ? 'Refreshing…' : '⟳ Refresh from doc'}
                </button>
                <button
                  onClick={onUnlinkDoc}
                  className="mt-1 w-full rounded border border-edge px-2 py-1 text-xs text-neutral-400 hover:bg-edge"
                >
                  Unlink
                </button>
                <p className="mt-2 text-[10px] text-neutral-500">
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
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".json,.docx,.pdf,.txt,.md,.markdown"
        className="hidden"
        onChange={onOpenFile}
      />
      <input
        ref={relinkRef}
        type="file"
        accept=".docx,.pdf,.txt,.md,.markdown"
        className="hidden"
        onChange={onRelinkFallback}
      />
      {dialog}
    </div>
  )
}

function BarBtn({
  label,
  onClick,
  title,
  primary,
  active,
}: {
  label: string
  onClick: () => void
  title?: string
  primary?: boolean
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded px-2.5 py-1 text-xs ${
        primary
          ? 'bg-accent text-white hover:brightness-110'
          : active
            ? 'border border-edge bg-edge text-neutral-100'
            : 'border border-edge text-neutral-300 hover:bg-edge'
      }`}
    >
      {label}
    </button>
  )
}
