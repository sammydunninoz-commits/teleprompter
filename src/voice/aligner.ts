import type { ScriptToken } from './tokens'

export interface AlignerConfig {
  /** How far behind the current position to search. */
  windowBack: number
  /** How far ahead to search (bounds the damage of one misheard word). */
  windowForward: number
  /** Similarity 0..1 required to accept a match. */
  matchThreshold: number
  /** ASR confidence below this is ignored entirely (confidence gate). */
  confidenceGate: number
  /** Follow the speaker backwards on a retake, or hold position. */
  allowBacktrack: boolean
  /** Consecutive misses before declaring an ad-lib / off-script stretch. */
  adlibMisses: number
  /** Gap (ms) between accepted words that counts as a long pause. */
  longPauseMs: number
}

export const DEFAULT_ALIGNER_CONFIG: AlignerConfig = {
  windowBack: 4,
  windowForward: 12,
  matchThreshold: 0.72,
  confidenceGate: 0.3,
  allowBacktrack: true,
  adlibMisses: 6,
  longPauseMs: 3500,
}

export type AlignEventKind =
  | 'match'
  | 'skip'
  | 'backtrack'
  | 'stumble'
  | 'adlib'
  | 'longpause'
  | 'lowconf'

export interface AlignEvent {
  kind: AlignEventKind
  index: number
  wid: string | null
}

export interface AlignResult {
  /** Current matched token index (−1 before the first match). */
  index: number
  wid: string | null
  /** Did the tracked position change on this push? */
  moved: boolean
  event: AlignEvent | null
}

/**
 * The shared alignment core (Features 5 & 6). Fuzzy-matches incoming recognised
 * words against a BOUNDED window of nearby expected tokens — never the whole
 * document — so a single misheard word can't cause a wild jump. Emits both the
 * new position (for auto-scroll) and a classification event (for director notes).
 *
 * Handles the three real behaviours explicitly:
 *  - skip ahead  → match found further ahead in the window ⇒ jump
 *  - ad-lib      → no matches for a stretch ⇒ freeze, don't guess
 *  - backtrack   → match found behind ⇒ follow back or hold (config toggle)
 */
export class Aligner {
  private cfg: AlignerConfig
  private tokens: ScriptToken[]
  private cur = -1
  private missStreak = 0
  private lastAcceptTs = 0
  private lastMatchedIndex = -1

  constructor(tokens: ScriptToken[], cfg: Partial<AlignerConfig> = {}) {
    this.cfg = { ...DEFAULT_ALIGNER_CONFIG, ...cfg }
    this.tokens = tokens
  }

  get index() {
    return this.cur
  }
  get currentWid(): string | null {
    return this.cur >= 0 && this.cur < this.tokens.length ? this.tokens[this.cur].wid : null
  }

  /** Reset tokens (doc changed) while keeping config. */
  setTokens(tokens: ScriptToken[]) {
    this.tokens = tokens
    if (this.cur >= tokens.length) this.cur = tokens.length - 1
  }

  /** Manual override: snap the tracker to a known position (by wid). */
  syncToWid(wid: string | null) {
    if (!wid) return
    const i = this.tokens.findIndex((t) => t.wid === wid)
    if (i >= 0) {
      this.cur = i
      this.lastMatchedIndex = i
      this.missStreak = 0
    }
  }

  syncToIndex(i: number) {
    this.cur = Math.max(-1, Math.min(this.tokens.length - 1, i))
    this.lastMatchedIndex = this.cur
    this.missStreak = 0
  }

  /**
   * Feed one recognised word. `ts` is a monotonic ms timestamp.
   */
  push(word: string, confidence: number, ts: number): AlignResult {
    const norm = normalize(word)
    if (!norm) return this.noMove(null)

    // Confidence gate — below threshold, don't move this frame.
    if (confidence < this.cfg.confidenceGate) {
      return this.noMove({ kind: 'lowconf', index: this.cur, wid: this.currentWid })
    }

    const from = Math.max(0, this.cur - this.cfg.windowBack)
    const to = Math.min(this.tokens.length - 1, this.cur + this.cfg.windowForward)

    let bestIdx = -1
    let bestSim = 0
    for (let i = from; i <= to; i++) {
      const sim = similarity(norm, this.tokens[i].norm)
      // Prefer the nearest-ahead match on ties to avoid clinging backwards.
      if (sim > bestSim || (sim === bestSim && bestIdx >= 0 && i > this.cur && bestIdx < this.cur)) {
        bestSim = sim
        bestIdx = i
      }
    }

    if (bestIdx < 0 || bestSim < this.cfg.matchThreshold) {
      this.missStreak++
      if (this.missStreak === this.cfg.adlibMisses) {
        return this.noMove({ kind: 'adlib', index: this.cur, wid: this.currentWid })
      }
      return this.noMove(null)
    }

    // We have an accepted match.
    const prev = this.cur
    const longPause =
      this.lastAcceptTs > 0 && ts - this.lastAcceptTs > this.cfg.longPauseMs
    this.lastAcceptTs = ts
    this.missStreak = 0

    let event: AlignEvent | null = { kind: 'match', index: bestIdx, wid: this.tokens[bestIdx].wid }

    if (bestIdx < prev) {
      // Backtrack / retake.
      if (this.cfg.allowBacktrack) {
        this.cur = bestIdx
        event = { kind: 'backtrack', index: bestIdx, wid: this.tokens[bestIdx].wid }
      } else {
        // Hold position but flag the retry as a stumble.
        return {
          index: this.cur,
          wid: this.currentWid,
          moved: false,
          event: { kind: 'stumble', index: bestIdx, wid: this.tokens[bestIdx].wid },
        }
      }
    } else if (bestIdx === prev || bestIdx === this.lastMatchedIndex) {
      // Same word again within the window → repeated word = stumble.
      event = { kind: 'stumble', index: bestIdx, wid: this.tokens[bestIdx].wid }
      this.cur = bestIdx
    } else if (bestIdx > prev + 1) {
      // Jumped forward past intermediate words that never matched = skipped line.
      this.cur = bestIdx
      event = { kind: 'skip', index: bestIdx, wid: this.tokens[bestIdx].wid }
    } else {
      this.cur = bestIdx
    }

    this.lastMatchedIndex = bestIdx

    // A long pause is reported in addition to the move (director note only).
    if (longPause) {
      return {
        index: this.cur,
        wid: this.currentWid,
        moved: this.cur !== prev,
        event: { kind: 'longpause', index: this.cur, wid: this.currentWid },
      }
    }

    return { index: this.cur, wid: this.currentWid, moved: this.cur !== prev, event }
  }

  private noMove(event: AlignEvent | null): AlignResult {
    return { index: this.cur, wid: this.currentWid, moved: false, event }
  }
}

function normalize(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/** Normalised similarity 0..1 from Levenshtein distance, with a phonetic bonus. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (!a || !b) return 0
  const maxLen = Math.max(a.length, b.length)
  const dist = levenshtein(a, b)
  let sim = 1 - dist / maxLen
  // Small phonetic nudge so accent/ASR noise on similar-sounding words still lands.
  if (sim < 1 && soundex(a) === soundex(b)) sim = Math.max(sim, 0.8)
  return sim
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp = new Array(n + 1)
  for (let j = 0; j <= n; j++) dp[j] = j
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = tmp
    }
  }
  return dp[n]
}

/** Classic Soundex for a cheap phonetic key. */
export function soundex(s: string): string {
  if (!s) return ''
  const codes: Record<string, string> = {
    b: '1', f: '1', p: '1', v: '1',
    c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
    d: '3', t: '3',
    l: '4',
    m: '5', n: '5',
    r: '6',
  }
  const first = s[0]
  let out = first
  let prevCode = codes[first] ?? ''
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const c = codes[s[i]] ?? ''
    if (c && c !== prevCode) out += c
    if (s[i] !== 'h' && s[i] !== 'w') prevCode = c
  }
  return (out + '000').slice(0, 4).toUpperCase()
}
