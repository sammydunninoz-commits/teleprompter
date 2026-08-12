import type { JSONContent } from '@tiptap/core'

/** Native project format — persisted to Dexie and exportable as .json */
export interface Project {
  id: string
  name: string
  /** The script as a TipTap/ProseMirror document (JSON). The single backbone. */
  doc: JSONContent
  createdAt: number
  updatedAt: number
  settings: ProjectSettings
}

/**
 * A live link between a project and a source document on disk. The handle is a
 * FileSystemFileHandle (structured-cloneable, so it persists in IndexedDB); the
 * app re-reads it on demand via the Refresh action. One link per project.
 */
export interface LinkedDoc {
  projectId: string
  name: string
  handle: FileSystemFileHandle
  linkedAt: number
  refreshedAt: number
}

export interface ProjectSettings {
  /** Words-per-minute target for the scroll engine. */
  wpm: number
  /** Colour used for question blocks (overridable per project). */
  questionColor: string
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  wpm: 150,
  questionColor: '#fbbf24',
}

/**
 * Transport state — the ONLY thing broadcast to talent displays.
 *
 * Deliberately transport-agnostic and position-derivable: every display window
 * computes its own current pixel offset each animation frame from these fields,
 * rather than receiving a per-frame position. This keeps all displays glued
 * together under frame drops and lets a future phone/tablet/WebRTC display drop
 * in without a rework.
 *
 *   offsetPx(now) = playing
 *     ? offsetAtStart + (now - startedAt) / 1000 * pxPerSec
 *     : offsetAtStart
 */
export interface TransportState {
  playing: boolean
  /** Scroll velocity in CSS pixels per second (derived from WPM + layout). */
  pxPerSec: number
  /** performance.now() timestamp (via shared time origin) when playback began. */
  startedAt: number
  /** Pixel offset captured at the moment playback began / was last corrected. */
  offsetAtStart: number
  /** Monotonic counter so displays can ignore stale/out-of-order messages. */
  seq: number
}

export const INITIAL_TRANSPORT: TransportState = {
  playing: false,
  pxPerSec: 0,
  startedAt: 0,
  offsetAtStart: 0,
  seq: 0,
}

/** Per-display configuration — stored per display, not globally. */
export interface DisplayConfig {
  id: string
  label: string
  mirrorH: boolean
  flipV: boolean
  rotate180: boolean
  fontSizePx: number
  lineHeight: number
  /** Eyeline position as a fraction of viewport height (0..1). */
  eyelineFrac: number
  eyelineStyle: 'line' | 'arrows' | 'gradient' | 'box' | 'none'
  /** Dim strength for the gradient/box overlay — 0 = off, 1 = full black. */
  eyelineGradientIntensity: number
  /** Height of the clear reading band in the 'box' style, in em of prompter text. */
  focusBoxHeightEm: number
  maxLineCh: number
  marginXFrac: number
  showQuestions: boolean
  showNotes: boolean // notes are director-only; kept false for talent displays
  blackout: boolean
}

export function defaultDisplayConfig(id: string, label: string): DisplayConfig {
  return {
    id,
    label,
    mirrorH: false,
    flipV: false,
    rotate180: false,
    fontSizePx: 56,
    lineHeight: 1.5,
    eyelineFrac: 0.4,
    eyelineStyle: 'box',
    eyelineGradientIntensity: 0.55,
    // Tall enough to show the current line centred plus the next line coming up
    // in the clear zone, so the reader isn't reading into the dimmed area.
    focusBoxHeightEm: 3.6,
    maxLineCh: 32,
    marginXFrac: 0.08,
    showQuestions: true,
    showNotes: false,
    blackout: false,
  }
}

/** Director flag kinds — set manually by the operator. Never broadcast to talent. */
export type FlagKind = 'retake' | 'stumble' | 'skip'

export interface DirectorFlag {
  id: string
  takeId: string
  takeLabel: string
  kind: FlagKind
  label: string
  /** ms since take start */
  atMs: number
  /** Stable word address the flag points at (for click-to-jump). */
  wid: string | null
  /** Short excerpt of the script at this point, for reference in the log. */
  snippet?: string
}
