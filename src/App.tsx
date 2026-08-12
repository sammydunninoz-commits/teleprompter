import { useState } from 'react'
import EditorPane from './editor/EditorPane'
import DisplayView from './display/DisplayView'
import TransportBar from './components/TransportBar'
import PromptSidebar from './components/PromptSidebar'
import ProjectSidebar from './components/ProjectSidebar'
import { useStore } from './store/useStore'
import { useKeyboardTransport } from './hooks/useKeyboardTransport'
import { useWakeLock } from './hooks/useWakeLock'
import { useOperatorBroadcaster } from './hooks/useOperatorBroadcaster'

export default function App() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  const doc = useStore((s) => s.doc)
  const docVersion = useStore((s) => s.docVersion)
  const displays = useStore((s) => s.displays)
  const questionColor = useStore((s) => s.settings.questionColor)
  const projectName = useStore((s) => s.projectName)
  const reportLayout = useStore((s) => s.reportLayout)
  const pause = useStore((s) => s.pause)
  const setLiveHighlight = useStore((s) => s.setLiveHighlight)
  const [projectsOpen, setProjectsOpen] = useState(true)

  // Keyboard transport active only in prompt mode; wake lock too.
  useKeyboardTransport(mode === 'prompt')
  useWakeLock(mode === 'prompt')
  // Answer state-sync requests from any display windows we've opened.
  useOperatorBroadcaster()

  const display = displays[0]

  return (
    <div className="flex h-full flex-col bg-panel text-neutral-100">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-edge bg-panelalt px-4 py-2">
        <span className="text-sm font-semibold text-accent">autocue</span>
        <span className="max-w-[16rem] truncate text-sm text-neutral-400" title={projectName}>
          {projectName}
        </span>

        <div className="ml-2 flex overflow-hidden rounded border border-edge">
          <TabBtn active={mode === 'edit'} onClick={() => setMode('edit')}>
            Edit
          </TabBtn>
          <TabBtn active={mode === 'prompt'} onClick={() => setMode('prompt')}>
            Prompt
          </TabBtn>
        </div>
      </header>

      {/* Body: project sidebar + main area */}
      <div className="flex min-h-0 flex-1">
        <ProjectSidebar open={projectsOpen} onToggle={() => setProjectsOpen((v) => !v)} />

        <div className="flex min-h-0 flex-1 flex-col">
          {mode === 'edit' ? (
            <div className="grid flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)] overflow-hidden">
              <div className="min-h-0 overflow-hidden border-r border-edge">
                <EditorPane />
              </div>
              <div className="relative min-h-0 overflow-hidden">
                <span className="absolute left-2 top-2 z-10 rounded bg-black/50 px-2 py-0.5 text-xs text-neutral-400">
                  Live preview
                </span>
                <DisplayView
                  doc={doc}
                  docVersion={docVersion}
                  config={display}
                  questionColor={questionColor}
                  onLayout={reportLayout}
                  showNotesOverride
                  className="h-full"
                />
              </div>
            </div>
          ) : (
            <div className="grid flex-1 grid-cols-[1fr_340px] grid-rows-[minmax(0,1fr)] overflow-hidden">
              <div className="relative min-h-0 overflow-hidden">
                <DisplayView
                  doc={doc}
                  docVersion={docVersion}
                  config={display}
                  questionColor={questionColor}
                  onLayout={reportLayout}
                  onAutoHold={(off) => pause(off)}
                  anchorOnEdit
                  onWordClick={(wid) =>
                    setLiveHighlight(useStore.getState().liveHighlightWid === wid ? null : wid)
                  }
                  className="h-full"
                />
              </div>
              <div className="min-h-0 overflow-hidden border-l border-edge">
                <PromptSidebar />
              </div>
            </div>
          )}

          {mode === 'prompt' && <TransportBar />}
        </div>
      </div>
    </div>
  )
}

function TabBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-sm ${active ? 'bg-accent text-white' : 'bg-panel text-neutral-300'}`}
    >
      {children}
    </button>
  )
}
