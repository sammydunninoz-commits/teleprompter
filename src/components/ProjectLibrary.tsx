import { useEffect, useState } from 'react'
import { listProjects, deleteProject } from '../store/db'
import { useStore } from '../store/useStore'
import type { Project } from '../store/types'

/** Local project library (Feature: Phase 3). Lists everything saved in Dexie. */
export default function ProjectLibrary({ onClose }: { onClose: () => void }) {
  const [projects, setProjects] = useState<Project[]>([])
  const loadProjectIntoState = useStore((s) => s.loadProjectIntoState)

  async function refresh() {
    setProjects(await listProjects())
  }
  useEffect(() => {
    refresh()
  }, [])

  function open(p: Project) {
    loadProjectIntoState(p)
    window.dispatchEvent(new CustomEvent('autocue:setcontent', { detail: {} }))
    onClose()
  }

  async function remove(id: string) {
    await deleteProject(id)
    refresh()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="max-h-[70vh] w-[520px] overflow-auto rounded-lg border border-edge bg-panel p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Project library</h2>
          <button onClick={onClose} className="rounded px-2 py-1 text-neutral-400 hover:bg-edge">
            ✕
          </button>
        </div>

        {projects.length === 0 && (
          <p className="py-8 text-center text-sm text-neutral-500">
            No saved projects yet. Use <b>Save</b> to store the current script here.
          </p>
        )}

        <ul className="flex flex-col gap-1">
          {projects.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded bg-panelalt px-3 py-2 text-sm"
            >
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-neutral-500">
                  {new Date(p.updatedAt).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => open(p)}
                  className="rounded bg-accent px-3 py-1 text-white hover:brightness-110"
                >
                  Open
                </button>
                <button
                  onClick={() => remove(p.id)}
                  className="rounded border border-edge px-2 py-1 text-neutral-400 hover:bg-edge"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
