import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { DirectorFlag, FlagKind } from './types'
import { directorChannel } from '../channel/channels'
import { db } from './db'
import { useStore } from './useStore'
import { snippetForWid } from '../voice/tokens'

/**
 * Director notes / take log (Feature 6). Kept in its own store and flowing over
 * the DIRECTOR channel only — never the talent channel. Flags persist per take
 * (not overwritten) so take 2 can be compared against take 1 when selecting
 * footage later.
 */
interface NotesState {
  currentTakeId: string
  currentTakeLabel: string
  takeStartedAt: number
  /** All flags currently loaded (across takes), newest first. */
  flags: DirectorFlag[]

  startTake: (label?: string) => void
  /** Create a flag at the current position/time and broadcast it. */
  addFlag: (kind: FlagKind, label: string, wid: string | null) => void
  /** Receive a flag from the director channel and persist it. */
  ingestFlag: (flag: DirectorFlag) => void
  loadFlags: () => Promise<void>
  clearAll: () => Promise<void>
}

function nowMs(): number {
  return performance.timeOrigin + performance.now()
}

export const useNotesStore = create<NotesState>((set, get) => ({
  currentTakeId: nanoid(6),
  currentTakeLabel: 'Take 1',
  takeStartedAt: nowMs(),
  flags: [],

  startTake: (label) => {
    const existing = new Set(get().flags.map((f) => f.takeId))
    const n = existing.size + 1
    set({
      currentTakeId: nanoid(6),
      currentTakeLabel: label || `Take ${n}`,
      takeStartedAt: nowMs(),
    })
  },

  addFlag: (kind, label, wid) => {
    const s = get()
    const flag: DirectorFlag = {
      id: nanoid(10),
      takeId: s.currentTakeId,
      takeLabel: s.currentTakeLabel,
      kind,
      label,
      atMs: Math.max(0, Math.round(nowMs() - s.takeStartedAt)),
      wid,
      snippet: snippetForWid(useStore.getState().doc, wid),
    }
    // Flags travel ONLY on the director channel. The channel subscriber (this
    // same store, via ingestFlag) is what actually records them — so there is a
    // single, director-only path and it can never reach the talent channel.
    directorChannel.post({ type: 'flag', flag })
  },

  ingestFlag: (flag) => {
    set((s) => ({ flags: [flag, ...s.flags] }))
    db.flags.put(flag).catch(() => {})
  },

  loadFlags: async () => {
    const all = await db.flags.orderBy('atMs').reverse().toArray()
    set({ flags: all })
  },

  clearAll: async () => {
    await db.flags.clear()
    set({ flags: [] })
  },
}))
