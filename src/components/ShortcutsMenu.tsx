import { useEffect, useRef, useState } from 'react'

/**
 * Header dropdown listing the built-in keyboard/mouse shortcuts. A discoverable
 * reference — the bindings themselves live in useKeyboardTransport / DisplayView
 * and are active in Prompt mode.
 */
const GROUPS: { title: string; items: [key: string, label: string][] }[] = [
  {
    title: 'Transport',
    items: [
      ['Space', 'Play / Pause'],
      ['Home', 'Back to top'],
      ['Page Up', 'Back a paragraph'],
      ['←  /  →', 'Nudge back / forward'],
    ],
  },
  {
    title: 'Speed',
    items: [
      ['↑  /  ↓', 'Faster / slower  (±50 WPM)'],
      ['Shift + ↑ / ↓', 'Big step  (±100 WPM)'],
      ['Mouse wheel', 'Faster / slower'],
    ],
  },
  {
    title: 'Screen',
    items: [['B', 'Blackout (toggle)']],
  },
]

export default function ShortcutsMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded border border-edge px-2 py-1 text-xs text-neutral-300 hover:bg-edge"
        title="Keyboard shortcuts"
      >
        ⌨ Shortcuts
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-72 rounded-lg border border-edge bg-panelalt p-3 shadow-xl">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-neutral-500">
            Active in Prompt mode
          </div>
          <div className="flex flex-col gap-3">
            {GROUPS.map((g) => (
              <div key={g.title}>
                <div className="mb-1 text-xs font-semibold text-neutral-400">{g.title}</div>
                <div className="flex flex-col gap-1">
                  {g.items.map(([key, label]) => (
                    <div key={key} className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-neutral-300">{label}</span>
                      <kbd className="whitespace-nowrap rounded border border-edge bg-panel px-1.5 py-0.5 font-mono text-[11px] text-neutral-400">
                        {key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
