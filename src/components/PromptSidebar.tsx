import { useState } from 'react'
import DisplaysPanel from './DisplaysPanel'
import VoicePanel from './VoicePanel'
import NotesPanel from './NotesPanel'
import { useVoiceController } from '../voice/useVoiceController'
import { useDirectorChannel } from '../hooks/useDirectorChannel'
import { useNotesStore } from '../store/useNotesStore'

type Tab = 'displays' | 'voice' | 'notes'

/** Right-hand operator panel in Prompt mode: displays, voice tracking, notes. */
export default function PromptSidebar() {
  const [tab, setTab] = useState<Tab>('displays')
  // Voice controller and director-channel subscription live here so they persist
  // across tab switches while in Prompt mode.
  const controller = useVoiceController()
  useDirectorChannel()
  const flagCount = useNotesStore((s) => s.flags.length)

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-edge">
        <TabBtn active={tab === 'displays'} onClick={() => setTab('displays')}>
          Displays
        </TabBtn>
        <TabBtn active={tab === 'voice'} onClick={() => setTab('voice')}>
          Voice{controller.state.active ? ' ●' : ''}
        </TabBtn>
        <TabBtn active={tab === 'notes'} onClick={() => setTab('notes')}>
          Notes{flagCount ? ` (${flagCount})` : ''}
        </TabBtn>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'displays' && <DisplaysPanel />}
        {tab === 'voice' && <VoicePanel controller={controller} />}
        {tab === 'notes' && <NotesPanel />}
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
