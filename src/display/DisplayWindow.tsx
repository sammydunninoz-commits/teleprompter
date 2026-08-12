import { useEffect, useState } from 'react'
import DisplayView from './DisplayView'
import { useStore } from '../store/useStore'
import { useTalentReceiver } from './useTalentReceiver'
import { useWakeLock } from '../hooks/useWakeLock'
import { defaultDisplayConfig } from '../store/types'

/**
 * A standalone prompter window, one per screen. Opened by the operator via
 * window.open(...?display=<id>). It is a pure follower: it receives state over
 * the talent BroadcastChannel and derives its own scroll position locally.
 */
export default function DisplayWindow({ displayId }: { displayId: string }) {
  useTalentReceiver(displayId)
  useWakeLock(true)

  const doc = useStore((s) => s.doc)
  const docVersion = useStore((s) => s.docVersion)
  const questionColor = useStore((s) => s.settings.questionColor)
  const config = useStore((s) => s.displays.find((d) => d.id === displayId))
  const reportLayout = useStore((s) => s.reportLayout)

  const [fs, setFs] = useState(false)
  const gotState = !!config

  // Track the REAL fullscreen state, not just our button click. Without this,
  // pressing Esc (or the OS leaving fullscreen) leaves `fs` stuck true, so the
  // Fullscreen button never comes back and the operator is locked out until the
  // window is reopened.
  useEffect(() => {
    const onChange = () => setFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  async function goFullscreen() {
    try {
      await document.documentElement.requestFullscreen()
      // `fs` is updated by the fullscreenchange listener above.
    } catch {
      /* ignored */
    }
  }

  const effectiveConfig = config ?? defaultDisplayConfig(displayId, 'Display')

  return (
    <div className="relative h-full w-full bg-black">
      <DisplayView
        doc={doc}
        docVersion={docVersion}
        config={effectiveConfig}
        questionColor={questionColor}
        onLayout={reportLayout}
        className="h-full w-full"
      />

      {!fs && (
        <button
          onClick={goFullscreen}
          className="absolute right-3 top-3 z-50 rounded bg-white/10 px-3 py-1.5 text-sm text-white/80 backdrop-blur hover:bg-white/20"
          title="Enter fullscreen on this screen"
        >
          ⤢ Fullscreen
        </button>
      )}

      {!gotState && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-white/40">
          Waiting for operator…
        </div>
      )}
    </div>
  )
}
