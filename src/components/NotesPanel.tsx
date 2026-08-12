import { useMemo } from 'react'
import { useNotesStore } from '../store/useNotesStore'
import { useStore } from '../store/useStore'
import { jumpToWid } from '../hooks/useDirectorChannel'
import { exportNotesJson, exportNotesTxt } from '../io/exportNotes'
import type { DirectorFlag, FlagKind } from '../store/types'
import { formatDuration } from '../scroll/transport'

const KIND_STYLE: Record<string, { icon: string; color: string; label: string }> = {
  retake: { icon: '↺', color: 'text-red-400', label: 'Retake' },
  stumble: { icon: '↩', color: 'text-amber-400', label: 'Stumble' },
  skip: { icon: '⤼', color: 'text-orange-400', label: 'Skip' },
}
const FALLBACK_STYLE = { icon: '⚑', color: 'text-neutral-400', label: 'Flag' }

/**
 * Director notes log (Feature 6). OPERATOR-ONLY — this view lives on the
 * director channel side and is never rendered on a talent surface. Flags persist
 * per take so take 2 can be compared against take 1.
 */
export default function NotesPanel() {
  const flags = useNotesStore((s) => s.flags)
  const currentTakeLabel = useNotesStore((s) => s.currentTakeLabel)
  const startTake = useNotesStore((s) => s.startTake)
  const addFlag = useNotesStore((s) => s.addFlag)
  const clearAll = useNotesStore((s) => s.clearAll)
  const projectName = useStore((s) => s.projectName)

  function flagNow(kind: FlagKind) {
    addFlag(kind, KIND_STYLE[kind].label, useStore.getState().currentEyelineWid)
  }

  // Group by take, current take first.
  const groups = useMemo(() => {
    const byTake = new Map<string, { label: string; items: DirectorFlag[] }>()
    for (const f of flags) {
      if (!byTake.has(f.takeId)) byTake.set(f.takeId, { label: f.takeLabel, items: [] })
      byTake.get(f.takeId)!.items.push(f)
    }
    return [...byTake.entries()]
  }, [flags])

  return (
    <div className="thin-scroll flex h-full flex-col overflow-auto text-sm">
      <div className="flex items-center justify-between border-b border-edge p-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-neutral-500">Current take</div>
          <div className="font-medium">{currentTakeLabel}</div>
        </div>
        <button
          onClick={() => startTake()}
          className="rounded border border-edge px-2 py-1 text-xs hover:bg-edge"
        >
          New take
        </button>
      </div>

      {/* Export / clear */}
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <span className="text-xs text-neutral-500">Export:</span>
        <button
          onClick={() => exportNotesTxt(flags, projectName)}
          disabled={flags.length === 0}
          className="rounded border border-edge px-2 py-1 text-xs hover:bg-edge disabled:opacity-40"
        >
          .txt
        </button>
        <button
          onClick={() => exportNotesJson(flags, projectName)}
          disabled={flags.length === 0}
          className="rounded border border-edge px-2 py-1 text-xs hover:bg-edge disabled:opacity-40"
        >
          .json
        </button>
        <button
          onClick={() => clearAll()}
          className="ml-auto rounded border border-edge px-2 py-1 text-xs text-neutral-400 hover:bg-edge"
        >
          Clear
        </button>
      </div>

      {/* Manual flag buttons — tap the one that fits the delivery. Each pins the
          current line + timecode into the log. */}
      <div className="grid grid-cols-3 gap-2 p-3">
        <FlagBtn kind="retake" onClick={flagNow} />
        <FlagBtn kind="stumble" onClick={flagNow} />
        <FlagBtn kind="skip" onClick={flagNow} />
      </div>

      <div className="flex-1">
        {groups.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-neutral-500">
            No flags yet. During a take, tap <b>Retake</b>, <b>Stumble</b> or <b>Skip</b> to mark
            the current line with a timecode so you can jump back to it later.
          </p>
        )}
        {groups.map(([takeId, g]) => (
          <div key={takeId} className="border-b border-edge/50">
            <div className="bg-panelalt px-3 py-1 text-xs font-semibold text-neutral-400">
              {g.label} · {g.items.length}
            </div>
            {g.items.map((f) => {
              const s = KIND_STYLE[f.kind] ?? FALLBACK_STYLE
              return (
                <button
                  key={f.id}
                  onClick={() => jumpToWid(f.wid)}
                  className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-edge/60"
                  title="Jump the script here for a retake"
                >
                  <span className={`mt-0.5 w-4 shrink-0 text-center ${s.color}`}>{s.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-neutral-200">
                      {f.snippet || f.label}
                    </span>
                    <span className="block text-[10px] text-neutral-500">{f.label}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-neutral-500">
                    {formatDuration(f.atMs / 1000)}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function FlagBtn({ kind, onClick }: { kind: FlagKind; onClick: (k: FlagKind) => void }) {
  const s = KIND_STYLE[kind]
  return (
    <button
      onClick={() => onClick(kind)}
      className="flex flex-col items-center gap-0.5 rounded border border-edge bg-panel py-2 hover:bg-edge"
      title={`Flag a ${s.label.toLowerCase()} at the current line`}
    >
      <span className={`text-lg ${s.color}`}>{s.icon}</span>
      <span className="text-xs">{s.label}</span>
    </button>
  )
}
