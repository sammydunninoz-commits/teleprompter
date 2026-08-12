import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import {
  listProjects,
  deleteProject,
  renameProject,
  duplicateProject,
} from '../store/db'
import { exportDocx } from '../io/exportDocx'
import { flash } from '../lib/flash'
import { useDialog } from './useDialog'
import type { Project } from '../store/types'

/**
 * Collapsible left sidebar — the saved-script library, and nothing else.
 *
 * Project actions (New / Load Script / Save / Save As / live document) live in
 * the top bar; see ProjectActions. Keeping this panel to one job means the
 * library list gets the full height of the sidebar.
 */
export default function ProjectSidebar({
  open,
  onToggle,
  reloadToken,
}: {
  open: boolean
  onToggle: () => void
  /** Bumped by the top bar after a save, so the list refreshes. */
  reloadToken: number
}) {
  const projectId = useStore((s) => s.projectId)
  const projectName = useStore((s) => s.projectName)
  const setProjectName = useStore((s) => s.setProjectName)
  const loadProjectIntoState = useStore((s) => s.loadProjectIntoState)
  const setMode = useStore((s) => s.setMode)

  const [projects, setProjects] = useState<Project[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const { dialog, ask } = useDialog()

  async function refresh() {
    setProjects(await listProjects())
  }
  useEffect(() => {
    if (open) refresh()
  }, [open, reloadToken])

  function reloadEditor() {
    window.dispatchEvent(new CustomEvent('autocue:setcontent', { detail: {} }))
  }

  function openFromLibrary(p: Project) {
    loadProjectIntoState(p)
    reloadEditor()
    setMode('edit')
    flash(`Opened “${p.name}”`)
  }

  async function onRename(p: Project) {
    const name = await ask({
      kind: 'prompt',
      title: 'Rename script',
      label: 'Script name',
      initial: p.name,
      confirmLabel: 'Rename',
    })
    if (typeof name !== 'string' || name === p.name) return
    await renameProject(p.id, name)
    // If the renamed script is the one currently loaded, the header must follow
    // it — otherwise the title bar keeps showing the old name.
    if (p.id === projectId) setProjectName(name)
    await refresh()
    flash(`Renamed to “${name}”`)
  }

  async function onDuplicate(p: Project) {
    const name = await ask({
      kind: 'prompt',
      title: 'Duplicate script',
      label: 'Name for the copy',
      initial: `${p.name} copy`,
      confirmLabel: 'Duplicate',
    })
    if (typeof name !== 'string') return
    await duplicateProject(p.id, name)
    await refresh()
    flash(`Duplicated as “${name}”`)
  }

  async function onExport(p: Project) {
    setBusyId(p.id)
    try {
      await exportDocx(p.doc, p.name)
      flash(`Exported “${p.name}.docx”`)
    } catch (err) {
      flash(`Export failed: ${(err as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  async function onDelete(p: Project) {
    const ok = await ask({
      kind: 'confirm',
      title: `Delete “${p.name}”?`,
      body: 'This removes it from the library. It can’t be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    await deleteProject(p.id)
    await refresh()
    flash('Deleted')
  }

  // --- Collapsed rail ---
  if (!open) {
    return (
      <div className="flex w-11 flex-col items-center border-r border-edge bg-panelalt py-3">
        <button
          onClick={onToggle}
          title="Open library"
          className="flex h-8 w-8 items-center justify-center rounded text-lg text-neutral-300 hover:bg-edge"
        >
          »
        </button>
      </div>
    )
  }

  // --- Expanded panel ---
  return (
    <div className="thin-scroll flex w-64 flex-col gap-2 overflow-auto border-r border-edge bg-panelalt p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Library</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={refresh}
            title="Refresh"
            className="rounded px-1 text-xs text-neutral-500 hover:bg-edge"
          >
            ⟳
          </button>
          <button
            onClick={onToggle}
            title="Collapse"
            className="rounded px-2 py-0.5 text-neutral-400 hover:bg-edge"
          >
            «
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {projects.length === 0 && (
          <p className="py-2 text-xs leading-relaxed text-neutral-500">
            No saved scripts yet. Use <b>Save</b> in the top bar to store the current one.
          </p>
        )}
        {projects.map((p) => {
          const isCurrent = p.id === projectId
          return (
            <div
              key={p.id}
              className={`group rounded px-2 py-1.5 ${isCurrent ? 'bg-accent/20' : 'bg-panel'}`}
            >
              <button onClick={() => openFromLibrary(p)} className="w-full text-left">
                <div className="truncate text-sm" title={p.name}>
                  {isCurrent ? projectName : p.name}
                </div>
                <div className="text-[10px] text-neutral-500">
                  {new Date(p.updatedAt).toLocaleDateString()}{' '}
                  {new Date(p.updatedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </button>

              {/* Row actions — revealed on hover, and kept visible while focused
                  so the row is still reachable by keyboard. */}
              <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <RowBtn onClick={() => onRename(p)} title="Rename">
                  Rename
                </RowBtn>
                <RowBtn onClick={() => onDuplicate(p)} title="Duplicate">
                  Duplicate
                </RowBtn>
                <RowBtn
                  onClick={() => onExport(p)}
                  title="Export as Word .docx"
                  disabled={busyId === p.id}
                >
                  {busyId === p.id ? '…' : 'Export'}
                </RowBtn>
                <RowBtn onClick={() => onDelete(p)} title="Delete" danger>
                  ✕
                </RowBtn>
              </div>
            </div>
          )
        })}
      </div>
      {dialog}
    </div>
  )
}

function RowBtn({
  children,
  onClick,
  title,
  danger,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`rounded border border-edge px-1.5 py-0.5 text-[10px] disabled:opacity-40 ${
        danger
          ? 'ml-auto text-neutral-500 hover:bg-red-900/40 hover:text-red-300'
          : 'text-neutral-400 hover:bg-edge hover:text-neutral-200'
      }`}
    >
      {children}
    </button>
  )
}
