import { create } from 'zustand'
import type { JSONContent } from '@tiptap/core'
import {
  DEFAULT_SETTINGS,
  INITIAL_TRANSPORT,
  defaultDisplayConfig,
  type DisplayConfig,
  type Project,
  type ProjectSettings,
  type TransportState,
} from './types'
import { makePaused, makePlaying, wpmToPxPerSec } from '../scroll/transport'
import { talentChannel } from '../channel/channels'
import { saveProject } from './db'
import { initialProjectState } from './session'
import { nanoid } from 'nanoid'

type Mode = 'edit' | 'prompt'

interface AppState {
  projectId: string
  projectName: string
  doc: JSONContent
  settings: ProjectSettings
  /** Bumped whenever the doc content changes — used to sync displays. */
  docVersion: number

  mode: Mode
  transport: TransportState
  /** Measured from the active display layout; drives WPM→px/s conversion. */
  wordsPerPx: number
  totalWords: number

  /** Phase 1: a single local display config; Phase 2 spawns one window per screen. */
  displays: DisplayConfig[]
  liveHighlightWid: string | null
  /** Word currently at the eyeline (authoritative view updates it) — lets the
   *  voice aligner resync after a manual scrub. Local only, not broadcast. */
  currentEyelineWid: string | null
  /** Max scroll offset (px) of the authoritative view — bounds the scrub bar. */
  maxOffset: number
  /** True while voice speed-match tracking is running (disables question auto-hold). */
  voiceActive: boolean

  /** Live-document link for the current project (see io/liveDoc.ts), or null.
   *  `syncedDoc` is the doc JSON captured at the last link/refresh, used to warn
   *  before a refresh would discard in-app edits (undefined = unknown). */
  linkedDoc: {
    name: string
    handle: FileSystemFileHandle
    refreshedAt: number | null
    syncedDoc?: string
  } | null

  // actions
  setMode: (m: Mode) => void
  setDoc: (doc: JSONContent) => void
  setProjectName: (n: string) => void
  setWpm: (wpm: number) => void
  reportLayout: (wordsPerPx: number, totalWords: number) => void

  play: (fromOffset: number) => void
  pause: (atOffset: number) => void
  togglePlay: (currentOffset: number) => void
  scrubTo: (offset: number) => void

  updateDisplay: (id: string, patch: Partial<DisplayConfig>) => void
  /** Apply a shared reading-layout change to every screen at once. */
  updateLayout: (patch: Partial<DisplayConfig>) => void
  addDisplay: (config: DisplayConfig) => void
  removeDisplay: (id: string) => void
  setBlackout: (id: string, on: boolean) => void
  blackoutAll: (on: boolean) => void
  setLiveHighlight: (wid: string | null) => void
  setEyelineWid: (wid: string | null) => void
  setMaxOffset: (px: number) => void
  setVoiceActive: (on: boolean) => void

  /** Operator: push the entire current state to a newly-opened display window. */
  broadcastFullState: () => void

  /** Display-window receivers — apply remote state WITHOUT re-broadcasting. */
  ingestTransport: (t: TransportState) => void
  ingestDoc: (doc: JSONContent, version: number) => void
  ingestDisplayConfig: (config: DisplayConfig) => void
  ingestLiveHighlight: (wid: string | null) => void

  loadProjectIntoState: (p: Project) => void
  newProject: () => void
  /**
   * The live in-memory state as a Project. Every editor keystroke lands in the
   * store, so this always includes unsaved edits — which is what both saving and
   * exporting want, and why they share it rather than each assembling their own.
   */
  snapshotProject: () => Project
  persist: () => Promise<void>

  setLinkedDoc: (
    link: {
      name: string
      handle: FileSystemFileHandle
      refreshedAt: number | null
      syncedDoc?: string
    } | null,
  ) => void
  markDocRefreshed: () => void
}

function broadcastTransport(t: TransportState) {
  talentChannel.post({ type: 'transport', transport: t })
}

export const useStore = create<AppState>((set, get) => ({
  // Restores the operator's last working script on load (crash/reload recovery);
  // a fresh blank project on the display/remote surfaces or a first run.
  ...initialProjectState(),
  docVersion: 0,

  mode: 'edit',
  transport: { ...INITIAL_TRANSPORT },
  wordsPerPx: 0,
  totalWords: 0,

  displays: [defaultDisplayConfig('local', 'Display 1')],
  liveHighlightWid: null,
  currentEyelineWid: null,
  maxOffset: 0,
  voiceActive: false,
  linkedDoc: null,

  setMode: (mode) => set({ mode }),

  setDoc: (doc) => {
    set((s) => ({ doc, docVersion: s.docVersion + 1 }))
    talentChannel.post({ type: 'doc', doc, docVersion: get().docVersion })
  },

  setProjectName: (projectName) => set({ projectName }),

  setWpm: (wpm) => {
    set((s) => ({ settings: { ...s.settings, wpm } }))
    // If currently playing, re-derive velocity so speed change takes effect live.
    const { transport, wordsPerPx } = get()
    if (transport.playing) {
      const pxPerSec = wpmToPxPerSec(wpm, wordsPerPx)
      const t = makePlaying(currentOffset(transport), pxPerSec, transport.seq + 1)
      set({ transport: t })
      broadcastTransport(t)
    }
  },

  reportLayout: (wordsPerPx, totalWords) => set({ wordsPerPx, totalWords }),

  play: (fromOffset) => {
    const { settings, wordsPerPx, transport } = get()
    const pxPerSec = wpmToPxPerSec(settings.wpm, wordsPerPx)
    const t = makePlaying(fromOffset, pxPerSec, transport.seq + 1)
    set({ transport: t })
    broadcastTransport(t)
  },

  pause: (atOffset) => {
    const { transport } = get()
    const t = makePaused(atOffset, transport.seq + 1)
    set({ transport: t })
    broadcastTransport(t)
  },

  togglePlay: (currentOffset) => {
    const { transport } = get()
    if (transport.playing) get().pause(currentOffset)
    else get().play(currentOffset)
  },

  scrubTo: (offset) => {
    const { transport } = get()
    const t = transport.playing
      ? makePlaying(offset, transport.pxPerSec, transport.seq + 1)
      : makePaused(offset, transport.seq + 1)
    set({ transport: t })
    broadcastTransport(t)
  },

  updateDisplay: (id, patch) => {
    set((s) => ({
      displays: s.displays.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }))
    const d = get().displays.find((x) => x.id === id)
    if (d) talentChannel.post({ type: 'display-config', config: d })
  },

  updateLayout: (patch) => {
    // Reading layout is shared: apply the change to EVERY screen so the talent
    // display mirrors the operator's readout exactly. Only orientation/blackout
    // stay per-screen (use updateDisplay for those).
    set((s) => ({ displays: s.displays.map((d) => ({ ...d, ...patch })) }))
    get().displays.forEach((d) => talentChannel.post({ type: 'display-config', config: d }))
  },

  addDisplay: (config) => {
    set((s) =>
      s.displays.some((d) => d.id === config.id)
        ? { displays: s.displays.map((d) => (d.id === config.id ? config : d)) }
        : { displays: [...s.displays, config] },
    )
    talentChannel.post({ type: 'display-config', config })
  },

  removeDisplay: (id) =>
    set((s) => ({ displays: s.displays.filter((d) => d.id !== id) })),

  setBlackout: (id, on) => {
    // Per-display blackout travels inside the display-config broadcast.
    get().updateDisplay(id, { blackout: on })
  },

  blackoutAll: (on) => {
    get().displays.forEach((d) => get().updateDisplay(d.id, { blackout: on }))
  },

  setLiveHighlight: (wid) => {
    set({ liveHighlightWid: wid })
    talentChannel.post({ type: 'live-highlight', wid })
  },

  setEyelineWid: (wid) => {
    if (get().currentEyelineWid !== wid) set({ currentEyelineWid: wid })
  },

  setMaxOffset: (px) => {
    if (Math.abs(get().maxOffset - px) > 1) set({ maxOffset: px })
  },

  setVoiceActive: (on) => set({ voiceActive: on }),

  broadcastFullState: () => {
    const s = get()
    talentChannel.post({ type: 'doc', doc: s.doc, docVersion: s.docVersion })
    talentChannel.post({ type: 'transport', transport: s.transport })
    talentChannel.post({ type: 'live-highlight', wid: s.liveHighlightWid })
    s.displays.forEach((config) => talentChannel.post({ type: 'display-config', config }))
  },

  ingestTransport: (t) => set({ transport: t }),
  ingestDoc: (doc, version) => set({ doc, docVersion: version }),
  ingestDisplayConfig: (config) =>
    set((s) =>
      s.displays.some((d) => d.id === config.id)
        ? { displays: s.displays.map((d) => (d.id === config.id ? config : d)) }
        : { displays: [...s.displays, config] },
    ),
  ingestLiveHighlight: (wid) => set({ liveHighlightWid: wid }),

  loadProjectIntoState: (p) =>
    set({
      projectId: p.id,
      projectName: p.name,
      doc: p.doc,
      settings: { ...DEFAULT_SETTINGS, ...p.settings },
      docVersion: 0,
      // Note: linkedDoc is NOT reset here. ProjectSidebar's projectId effect
      // reloads the correct link (or null) from Dexie. Resetting it here would
      // wrongly blank the panel when re-opening the already-current project
      // (same projectId → the effect doesn't refire).
    }),

  newProject: () =>
    set({
      projectId: nanoid(10),
      projectName: 'Untitled script',
      doc: emptyDoc(),
      settings: { ...DEFAULT_SETTINGS },
      docVersion: 0,
      // A brand-new projectId → the sidebar effect resolves the link to null.
    }),

  snapshotProject: () => {
    const { projectId, projectName, doc, settings } = get()
    return {
      id: projectId,
      name: projectName,
      doc,
      settings,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  },

  persist: async () => {
    await saveProject(get().snapshotProject())
  },

  setLinkedDoc: (link) => set({ linkedDoc: link }),

  markDocRefreshed: () =>
    set((s) =>
      s.linkedDoc ? { linkedDoc: { ...s.linkedDoc, refreshedAt: Date.now() } } : {},
    ),
}))

function currentOffset(t: TransportState): number {
  // Snapshot helper used when re-deriving velocity mid-play.
  if (!t.playing) return t.offsetAtStart
  const now = performance.timeOrigin + performance.now()
  return t.offsetAtStart + ((now - t.startedAt) / 1000) * t.pxPerSec
}

// Dev-only: expose the store for debugging in the console.
if (import.meta.env.DEV) {
  ;(window as unknown as { __store: typeof useStore }).__store = useStore
}

export function emptyDoc(): JSONContent {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  }
}
