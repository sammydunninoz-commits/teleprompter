import { useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { defaultDisplayConfig, pickLayout } from '../store/types'
import DisplaySettings from './DisplaySettings'
import { nanoid } from 'nanoid'

interface ScreenInfo {
  id: string
  label: string
  left: number
  top: number
  width: number
  height: number
  isPrimary: boolean
}

/**
 * Operator control for talent displays (Feature 3). Enumerates screens via the
 * Window Management API, spawns one prompter window per screen at its bounds,
 * and edits per-display config. Falls back to a plain popup the operator drags
 * to a second monitor when the API is unavailable or permission is denied.
 */
export default function DisplaysPanel() {
  const displays = useStore((s) => s.displays)
  const addDisplay = useStore((s) => s.addDisplay)
  const removeDisplay = useStore((s) => s.removeDisplay)
  const blackoutAll = useStore((s) => s.blackoutAll)
  const broadcastFullState = useStore((s) => s.broadcastFullState)

  const [screens, setScreens] = useState<ScreenInfo[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>('local')
  const windowsRef = useRef<Map<string, Window>>(new Map())

  async function detectScreens() {
    setNote(null)
    const anyWin = window as unknown as {
      getScreenDetails?: () => Promise<{ screens: ScreenDetailScreen[] }>
    }
    if (!anyWin.getScreenDetails) {
      setNote(
        'Window Management API not available in this browser. Use “Open display window” and drag it to your prompter screen, then click Fullscreen there.',
      )
      return
    }
    try {
      const details = await anyWin.getScreenDetails()
      setScreens(
        details.screens.map((s, i) => ({
          id: `screen-${i}`,
          label: (s.label || `Screen ${i + 1}`) + (s.isPrimary ? ' (primary)' : ''),
          left: s.availLeft,
          top: s.availTop,
          width: s.availWidth,
          height: s.availHeight,
          isPrimary: s.isPrimary,
        })),
      )
    } catch (e) {
      setNote(`Screen access denied or failed: ${(e as Error).message}`)
    }
  }

  function openWindow(screen?: ScreenInfo) {
    const id = screen?.id ?? `win-${nanoid(4)}`
    const label = screen?.label ?? `Display ${displays.length}`
    if (!displays.some((d) => d.id === id)) {
      // Inherit the current SHARED reading layout so a new screen matches the
      // others immediately; only its orientation starts at the defaults.
      const layout = displays[0] ? pickLayout(displays[0]) : {}
      addDisplay({ ...defaultDisplayConfig(id, label), ...layout })
    }
    const features = screen
      ? `left=${screen.left},top=${screen.top},width=${screen.width},height=${screen.height}`
      : 'width=1280,height=720'
    const url = `${window.location.pathname}?display=${encodeURIComponent(id)}`
    const w = window.open(url, id, features)
    if (!w) {
      setNote('Popup blocked — allow popups for this site to open a display window.')
      return
    }
    windowsRef.current.set(id, w)
    setSelected(id)
    // Push current state shortly after the child boots (it also requests it).
    window.setTimeout(() => broadcastFullState(), 600)
  }

  function closeWindow(id: string) {
    windowsRef.current.get(id)?.close()
    windowsRef.current.delete(id)
    removeDisplay(id)
    if (selected === id) setSelected('local')
  }

  return (
    <div className="thin-scroll flex h-full flex-col overflow-auto bg-panel text-sm">
      <div className="border-b border-edge p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Displays
          </h2>
          <button
            onClick={() => blackoutAll(true)}
            className="rounded bg-red-600/90 px-2 py-1 text-xs text-white hover:bg-red-600"
            title="Blackout every display (B)"
          >
            Blackout all
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={detectScreens} className="rounded border border-edge px-2 py-1 hover:bg-edge">
            Detect screens
          </button>
          <button onClick={() => openWindow()} className="rounded bg-accent px-2 py-1 text-white hover:brightness-110">
            Open display window
          </button>
        </div>

        {note && <p className="mt-2 text-xs text-amber-400/90">{note}</p>}

        {screens.length > 0 && (
          <div className="mt-3 flex flex-col gap-1">
            {screens.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded bg-panelalt px-2 py-1">
                <span className="text-xs text-neutral-300">
                  {s.label} · {s.width}×{s.height}
                </span>
                <button
                  onClick={() => openWindow(s)}
                  className="rounded border border-edge px-2 py-0.5 text-xs hover:bg-edge"
                >
                  Open here
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Display selector */}
      <div className="flex flex-wrap gap-1 border-b border-edge p-3">
        {displays.map((d) => (
          <button
            key={d.id}
            onClick={() => setSelected(d.id)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
              selected === d.id ? 'bg-accent text-white' : 'bg-panelalt text-neutral-300'
            }`}
          >
            {d.label}
            {d.id !== 'local' && (
              <span
                onClick={(e) => {
                  e.stopPropagation()
                  closeWindow(d.id)
                }}
                className="ml-1 rounded px-1 text-white/70 hover:bg-black/30"
                title="Close this display window"
              >
                ✕
              </span>
            )}
          </button>
        ))}
      </div>

      <DisplaySettings displayId={selected} />
    </div>
  )
}

interface ScreenDetailScreen {
  label: string
  availLeft: number
  availTop: number
  availWidth: number
  availHeight: number
  isPrimary: boolean
}
