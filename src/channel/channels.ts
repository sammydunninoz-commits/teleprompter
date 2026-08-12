import type { DirectorFlag, DisplayConfig, TransportState } from '../store/types'
import type { TransportCommand } from '../scroll/commands'
import type { JSONContent } from '@tiptap/core'

/**
 * Multi-window sync (Feature 3).
 *
 * HARD ARCHITECTURAL RULE: the talent-facing channel and the director-notes
 * channel are DISTINCT BroadcastChannels, separate from the start (Feature 6).
 * Director flags must never travel on the channel a talent display subscribes
 * to — this is a "never leaks" guarantee, not a UI toggle.
 *
 * We broadcast transport STATE, never per-frame position (Feature 3 / known
 * hard part #1). Displays derive their own position each animation frame.
 */

export const TALENT_CHANNEL = 'autocue-talent'
export const DIRECTOR_CHANNEL = 'autocue-director'

/** Messages the operator sends to talent display windows. */
export type TalentMessage =
  | { type: 'transport'; transport: TransportState }
  | { type: 'doc'; doc: JSONContent; docVersion: number }
  | { type: 'display-config'; config: DisplayConfig }
  | { type: 'live-highlight'; wid: string | null }
  | { type: 'blackout'; on: boolean }
  | { type: 'hello' } // a new display window announces itself; operator replies with full state
  | { type: 'request-state'; displayId: string }
  /**
   * Display → operator. Displays remain pure followers of transport STATE: they
   * never mutate their own scroll. A keypress in a display window travels up as
   * a command, the operator applies it, and the resulting state comes back down
   * the normal broadcast — so every window stays glued to one source of truth
   * instead of diverging.
   */
  | { type: 'control'; cmd: TransportCommand }

/** Messages on the director-only channel (voice flags, notes). Never seen by talent. */
export type DirectorMessage = { type: 'flag'; flag: DirectorFlag }

type Handler<T> = (msg: T) => void

class TypedChannel<T> {
  private ch: BroadcastChannel
  private handlers = new Set<Handler<T>>()

  constructor(name: string) {
    this.ch = new BroadcastChannel(name)
    this.ch.onmessage = (e: MessageEvent<T>) => {
      for (const h of this.handlers) h(e.data)
    }
  }

  post(msg: T): void {
    this.ch.postMessage(msg)
    // BroadcastChannel does NOT deliver a message back to the object that sent
    // it, so notify local subscribers directly. This makes the channel a proper
    // event bus that works within the sending window as well as across windows —
    // needed e.g. for the director-notes log, which posts and listens in the
    // same (operator) window.
    for (const h of this.handlers) h(msg)
  }

  subscribe(h: Handler<T>): () => void {
    this.handlers.add(h)
    return () => this.handlers.delete(h)
  }

  close(): void {
    this.handlers.clear()
    this.ch.close()
  }
}

export const talentChannel = new TypedChannel<TalentMessage>(TALENT_CHANNEL)
export const directorChannel = new TypedChannel<DirectorMessage>(DIRECTOR_CHANNEL)
