import { useState } from 'react'
import DisplaysPanel from './DisplaysPanel'
import VoicePanel from './VoicePanel'
import NotesPanel from './NotesPanel'
import RemotePanel from './RemotePanel'
import { useVoiceController } from '../voice/useVoiceController'
import { usePeerHost } from '../remote/usePeerHost'
import { useDirectorChannel } from '../hooks/useDirectorChannel'
import { useNotesStore } from '../store/useNotesStore'
import { FEATURES } from '../lib/features'

type Tab = 'displays' | 'voice' | 'remote' | 'notes'

/** Right-hand operator panel in Prompt mode: displays, phone remote, notes. */
export default function PromptSidebar() {
  const [tab, setTab] = useState<Tab>('displays')
  // The voice controller and the peer host live here, not in their panels, so
  // an in-progress session survives switching tabs while in Prompt mode.
  const controller = useVoiceController(FEATURES.voice)
  const host = usePeerHost()
  useDirectorChannel()
  const flagCount = useNotesStore((s) => s.flags.length)

  // Guard against a stale tab selection if a feature is switched off.
  const active: Tab = tab === 'voice' && !FEATURES.voice ? 'displays' : tab

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-edge">
        <TabBtn active={active === 'displays'} onClick={() => setTab('displays')}>
          Displays
        </TabBtn>
        {FEATURES.voice && (
          <TabBtn active={active === 'voice'} onClick={() => setTab('voice')}>
            Voice{controller.state.active ? ' ●' : ''}
          </TabBtn>
        )}
        {FEATURES.remote && (
          <TabBtn active={active === 'remote'} onClick={() => setTab('remote')}>
            Remote{host.state.peers > 0 ? ' ●' : ''}
          </TabBtn>
        )}
        <TabBtn active={active === 'notes'} onClick={() => setTab('notes')}>
          Notes{flagCount ? ` (${flagCount})` : ''}
        </TabBtn>
      </div>
      <div className="min-h-0 flex-1">
        {active === 'displays' && <DisplaysPanel />}
        {active === 'voice' && FEATURES.voice && <VoicePanel controller={controller} />}
        {active === 'remote' && FEATURES.remote && (
          <RemotePanel state={host.state} start={host.start} stop={host.stop} />
        )}
        {active === 'notes' && <NotesPanel />}
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
      className={`flex-1 px-2 py-2 text-xs font-medium ${
        active ? 'bg-panelalt text-accent' : 'text-neutral-400 hover:bg-panelalt/50'
      }`}
    >
      {children}
    </button>
  )
}
