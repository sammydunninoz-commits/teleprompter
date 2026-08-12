import { useCallback, useEffect, useRef, useState } from 'react'
import { Aligner, DEFAULT_ALIGNER_CONFIG, type AlignerConfig } from './aligner'
import { tokensFromDoc, type ScriptToken } from './tokens'
import { WpmEstimator } from './wpm'
import { createRecognizer, type Recognizer, type RecognizerKind } from './recognizer'
import { useStore } from '../store/useStore'
import { useNotesStore } from '../store/useNotesStore'
import { offsetAt } from '../scroll/transport'

// --- Motion tuning -------------------------------------------------------------
// Scroll speed = a stable pace average (feedforward) + a gentle pull that keeps
// the spoken word sitting HIGH in the focus box (feedback). These are tuned for a
// calm, buttery roll the interviewee can follow — deliberately no user slider.

/** Words to aim AHEAD of the last-recognised word. Recognition lags real speech
 *  by a beat, so a tiny lead leaves the reader drifting toward the bottom of the
 *  focus box (and into the dim zone). A larger lead cancels that lag AND lifts the
 *  live line into the upper third of the clear band, where it's easiest to read. */
const LEAD_WORDS = 6
/** Feedback strength (wpm per word of error). Gentle, so alignment noise doesn't
 *  turn into speed wobble. */
const KP_WPM_PER_WORD = 3
const ERROR_CLAMP_WORDS = 10
/** Ignore sub-word position errors — stops the speed hunting around the target
 *  when the reader is basically on the line. */
const ERR_DEADBAND_WORDS = 1.5
/** EMA smoothing for the position-error signal (lower = steadier). */
const ERR_ALPHA = 0.25
/** Output smoothing toward the target speed each tick (lower = smoother). */
const OUT_ALPHA = 0.5
/** Max speed change per control tick (~120 ms) — caps acceleration so velocity
 *  ramps rather than stepping. This is the main "buttery" lever. */
const MAX_WPM_STEP = 5
/** LAUNCH phase — the first sentence's worth of words after speech begins.
 *  Recognition lags your first words by ~a beat, so the scroll starts behind and
 *  you drop below the box. For these first words we let it catch up fast (higher
 *  accel cap, lighter error smoothing, no deadband), then it settles into the
 *  calm steady-state values above once you're locked in. */
const LAUNCH_WORDS = 10
const MAX_WPM_STEP_LAUNCH = 20
const ERR_ALPHA_LAUNCH = 0.6
/** If the recognised position drifts this many words from the reading line, the
 *  tracker has lost the voice (a big skip or a run of mis-recognition) — re-anchor
 *  it to the eyeline so it resumes matching instead of coasting on the average. */
const RESYNC_DRIFT_WORDS = 16
const clampWith = (v: number, c: number) => Math.max(-c, Math.min(c, v))
/** Fallback seed pace (wpm) if the project has no sensible WPM set. */
const DEFAULT_SEED_WPM = 150
/** A recognised word within this many ms → alignment is FRESH, so apply the gentle
 *  position lock. Beyond it we GLIDE (below). */
const FRESH_MS = 700
/** Only after this much continuous silence do we actually HOLD (the reader really
 *  stopped). Below it — through punctuation micro-pauses and the gaps between
 *  recognition bursts — the scroll keeps GLIDING at the steady average so it never
 *  stalls-then-surges. This is the key fix for the hold/surge flicker. */
const HOLD_MS = 2000

const blockOf = (wid: string | null | undefined) => (wid ? wid.split('#')[0] : '')

/** Reading words remaining in the current block after index i. */
function wordsLeftInBlock(tokens: ScriptToken[], i: number): number {
  const b = blockOf(tokens[i]?.wid)
  let n = 0
  let k = i + 1
  while (k < tokens.length && blockOf(tokens[k].wid) === b) {
    n++
    k++
  }
  return n
}

/** First reading token of the NEXT section (skips the rest of this block and any
 *  question/heading blocks). −1 if there is no further reading section. */
function nextReadingStart(tokens: ScriptToken[], i: number): number {
  const b = blockOf(tokens[i]?.wid)
  let k = i + 1
  while (k < tokens.length && blockOf(tokens[k].wid) === b) k++ // skip rest of this block
  while (k < tokens.length && !tokens[k].isReading) k++ // skip questions/headings
  return k < tokens.length ? k : -1
}

export interface VoiceState {
  active: boolean
  kind: RecognizerKind
  streamsOffDevice: boolean
  status: string
  error: string | null
  allowBacktrack: boolean
  wordsSeen: number
  /** Live estimate of the speaker's pace, driving the scroll speed. */
  estimatedWpm: number
}

function nowMs() {
  return performance.timeOrigin + performance.now()
}

/**
 * Voice-following in SPEED-MATCH mode (Feature 5).
 *
 * The prompter rolls continuously and the scroll WPM is matched to how fast the
 * speaker is moving through the script — it does NOT snap the position to matched
 * words. The aligner is still used, but only to (a) measure script progress for
 * the WPM estimate and (b) feed the director-notes classifier in the background.
 * Manual control (scrub / speed / pause) always overrides.
 *
 * Pass `enabled: false` (see FEATURES.voice) to make the controller completely
 * inert: no aligner is built, no store subscription is installed, and `start()`
 * is a no-op, so no microphone permission is ever requested. The hook is still
 * called unconditionally by the caller, keeping hook order stable.
 */
export function useVoiceController(enabled = true) {
  const [state, setState] = useState<VoiceState>({
    active: false,
    kind: 'webspeech',
    streamsOffDevice: true,
    status: 'Idle',
    error: null,
    allowBacktrack: true,
    wordsSeen: 0,
    estimatedWpm: 0,
  })

  const alignerRef = useRef<Aligner | null>(null)
  const tokensRef = useRef<ScriptToken[]>([])
  const recognizerRef = useRef<Recognizer | null>(null)
  const wpmRef = useRef(new WpmEstimator())
  const manualUntilRef = useRef<number>(0)
  const voiceApplyingRef = useRef<boolean>(false)
  const lastAppliedWpmRef = useRef<number>(-1)
  const smoothWpmRef = useRef<number>(-1)
  // Coast-through-question state.
  const cruisePaceRef = useRef<number>(130)
  const lastSpeechRef = useRef<number>(0)
  const coastingRef = useRef<boolean>(false)
  const coastEndRef = useRef<number>(-1)
  const speechStartedRef = useRef<boolean>(false)
  const skimmingRef = useRef<boolean>(false)
  const skimTargetRef = useRef<number>(-1)
  const skimPaceRef = useRef<number>(120)
  const idleTimerRef = useRef<number | undefined>(undefined)
  const cfgRef = useRef<AlignerConfig>({ ...DEFAULT_ALIGNER_CONFIG })
  // Smoothed position error (words), so the feedback term reacts to the trend,
  // not to every bursty alignment tick. −Infinity = not yet primed.
  const errSmoothRef = useRef<number>(Number.NEGATIVE_INFINITY)
  // Launch phase: recognised words since speech began, and whether we're still
  // in the fast-catch-up window (mirrored so driveScroll can read it).
  const launchWordsRef = useRef<number>(0)
  const launchingRef = useRef<boolean>(false)

  // Rebuild aligner tokens whenever the document changes.
  const docVersion = useStore((s) => s.docVersion)
  useEffect(() => {
    if (!enabled) return
    const tokens = tokensFromDoc(useStore.getState().doc)
    tokensRef.current = tokens
    if (alignerRef.current) alignerRef.current.setTokens(tokens)
    else alignerRef.current = new Aligner(tokens, cfgRef.current)
  }, [docVersion, enabled])

  // Detect manual overrides: any transport change we didn't initiate counts as
  // manual → resync the aligner to the eyeline and yield speed control briefly.
  useEffect(() => {
    if (!enabled) return
    const unsub = useStore.subscribe((s, prev) => {
      if (s.transport.seq === prev.transport.seq) return
      if (voiceApplyingRef.current) return // our own speed update
      manualUntilRef.current = nowMs() + 1500
      lastAppliedWpmRef.current = -1
      smoothWpmRef.current = -1
      errSmoothRef.current = Number.NEGATIVE_INFINITY
      alignerRef.current?.syncToWid(useStore.getState().currentEyelineWid)
    })
    return unsub
  }, [enabled])

  /** Set the scroll speed from the estimate and make sure the roll is running. */
  function applyWpm(wpm: number) {
    const w = Math.round(wpm)
    const cur = useStore.getState()
    // Skip redundant updates when already rolling at ~this speed (avoids
    // re-broadcasting transport 4×/sec when the pace is steady).
    if (cur.transport.playing && w === lastAppliedWpmRef.current) return
    voiceApplyingRef.current = true
    cur.setWpm(w)
    const st = useStore.getState()
    if (!st.transport.playing) st.play(offsetAt(st.transport, nowMs()))
    voiceApplyingRef.current = false
    lastAppliedWpmRef.current = w
    setState((s) => (s.estimatedWpm === w ? s : { ...s, estimatedWpm: w }))
  }

  const handleWord = useCallback((word: string, confidence: number, ts: number) => {
    const aligner = alignerRef.current
    if (!aligner) return
    lastSpeechRef.current = nowMs() // the reader is talking
    speechStartedRef.current = true // first word → the roll may begin
    if (launchWordsRef.current < LAUNCH_WORDS) launchWordsRef.current++
    const res = aligner.push(word, confidence, ts)
    setState((st) => ({ ...st, wordsSeen: st.wordsSeen + 1 }))

    // Note: director flags are set manually by the operator (Retake / Stumble /
    // Skip buttons). Automatic speech-based flagging was removed as unreliable —
    // the aligner is used only to drive the scroll speed now.

    // Update the feedforward pace estimate from forward script progress. The
    // actual scroll speed is set by the control loop (below), which also folds
    // in position feedback — so no speed is applied directly here.
    if (res.moved && res.index >= 0) {
      wpmRef.current.advance(res.index, ts)
    }
  }, [])

  /**
   * Control loop (~4 Hz): scroll speed = matched pace (feedforward) + a gentle
   * correction toward keeping the speaker's current word on the eyeline
   * (feedback). Closing the loop on position stops both drift-behind (lag) and
   * running-ahead (rush) without ever jumping the scroll.
   */
  /** Low-pass the target speed, cap its rate of change, and apply it. Two stages
   *  of shaping keep the roll buttery: (1) a low-pass toward the target so it
   *  never jerks on one tick, then (2) an acceleration cap so even a big target
   *  jump becomes a smooth ramp rather than a step in velocity. */
  function driveScroll(rawTarget: number) {
    const target = Math.max(0, rawTarget)
    let smoothed =
      smoothWpmRef.current < 0 ? target : OUT_ALPHA * target + (1 - OUT_ALPHA) * smoothWpmRef.current
    // Acceleration cap, relative to the speed we last actually applied. Raised
    // during the launch phase so the scroll can catch up to the reader quickly.
    const step = launchingRef.current ? MAX_WPM_STEP_LAUNCH : MAX_WPM_STEP
    const last = lastAppliedWpmRef.current
    if (last >= 0) {
      const delta = smoothed - last
      if (delta > step) smoothed = last + step
      else if (delta < -step) smoothed = last - step
    }
    smoothWpmRef.current = smoothed
    if (smoothed < 1 && !useStore.getState().transport.playing) return
    applyWpm(smoothed)
  }

  function controlTick() {
    const aligner = alignerRef.current
    if (!aligner) return
    if (nowMs() < manualUntilRef.current) {
      const wid = useStore.getState().currentEyelineWid
      if (wid) aligner.syncToWid(wid)
      return
    }

    const tokens = tokensRef.current
    const eyelineWid = useStore.getState().currentEyelineWid
    const eyelineIndex = eyelineWid ? tokens.findIndex((t) => t.wid === eyelineWid) : aligner.index
    const idleMs = nowMs() - lastSpeechRef.current
    // Default off; the following branch turns it on for the first LAUNCH_WORDS so
    // the pre-speech skim/hold ramps use the calm cap.
    launchingRef.current = false

    // --- Skim past a leading title/question at the start ----------------------
    if (skimmingRef.current) {
      const reached = eyelineIndex >= 0 && eyelineIndex >= skimTargetRef.current
      if (speechStartedRef.current || reached) {
        skimmingRef.current = false
        if (reached && !speechStartedRef.current) {
          smoothWpmRef.current = 0 // arrive and settle promptly at the first line
          driveScroll(0)
          return
        }
        // else the reader began during the skim → fall through to normal lock.
      } else {
        if (eyelineIndex >= 0) aligner.syncToIndex(Math.min(skimTargetRef.current, eyelineIndex + 1))
        driveScroll(skimPaceRef.current)
        return
      }
    }

    // Hold at the first sentence until the reader actually starts speaking.
    if (!speechStartedRef.current) {
      driveScroll(0)
      return
    }

    const pace = wpmRef.current.current() // stable average, never decays on pauses
    cruisePaceRef.current = pace
    let target: number

    // Safety net: if the tracker has drifted far from the reading line it has lost
    // the voice — re-anchor near the eyeline (a touch behind, where the recogniser
    // trails the reader) so it can pick the words back up instead of running on the
    // constant average forever. Skipped during a gap coast (the lag there is normal).
    if (
      !coastingRef.current &&
      eyelineIndex >= 0 &&
      Math.abs(eyelineIndex - aligner.index) > RESYNC_DRIFT_WORDS
    ) {
      aligner.syncToIndex(Math.max(0, eyelineIndex - LEAD_WORDS))
      errSmoothRef.current = Number.NEGATIVE_INFINITY
    }

    // --- Paragraph-gap coast --------------------------------------------------
    // Exit the gap coast once the next paragraph's first line has reached the
    // eyeline, OR the reader has actually spoken past it (real progress — our own
    // sync never pushes aligner.index beyond coastEnd, so a strict `>` means the
    // reader resumed early).
    if (
      coastingRef.current &&
      ((eyelineIndex >= 0 && eyelineIndex >= coastEndRef.current) ||
        aligner.index > coastEndRef.current)
    ) {
      coastingRef.current = false
    }
    // Enter the gap coast when the READING LINE (eyeline) reaches the end of a
    // paragraph that has a further section ahead — with the recognised position as
    // a backup. Keying off the eyeline makes this independent of recognition lag
    // (which was stalling a word or two short and dropping into the mid-line HOLD).
    // No pause is required: the pace carries straight through the blank space.
    if (!coastingRef.current) {
      const endByEye = eyelineIndex >= 0 && wordsLeftInBlock(tokens, eyelineIndex) <= 1
      const endByAlign = aligner.index >= 0 && wordsLeftInBlock(tokens, aligner.index) <= 2
      const endIdx = endByEye ? eyelineIndex : endByAlign ? aligner.index : -1
      if (endIdx >= 0) {
        const nb = nextReadingStart(tokens, endIdx)
        if (nb > endIdx && !(eyelineIndex >= 0 && eyelineIndex >= nb)) {
          coastingRef.current = true
          coastEndRef.current = nb
        }
      }
    }

    if (coastingRef.current) {
      // Roll through the gap at the steady average until the next line reaches the
      // eyeline; the exit checks above then hand back to follow/hold. The pause in
      // the gap must not touch the pace, so we tell the estimator to skip it.
      // We deliberately do NOT move the tracker here: paragraph gaps are only one
      // token wide, so the aligner re-locks on the next paragraph by itself — and
      // yanking it forward used to shove the previous line's still-arriving words
      // out of its match window, freezing it.
      wpmRef.current.noteGap()
      target = pace
    } else if (idleMs < FRESH_MS) {
      // --- Following: fresh recognition → steady average + gentle position lock --
      target = pace
      if (aligner.index >= 0 && eyelineIndex >= 0) {
        const launching = launchWordsRef.current < LAUNCH_WORDS
        launchingRef.current = launching
        const rawErr = clampWith(aligner.index + LEAD_WORDS - eyelineIndex, ERROR_CLAMP_WORDS)
        // Smooth the error so bursty recognition doesn't translate into speed
        // wobble, then ignore sub-word errors so the speed holds steady when the
        // reader is on the line. During launch we respond faster (lighter smoothing)
        // and skip the deadband so it actively pulls the line back up into the box.
        const errAlpha = launching ? ERR_ALPHA_LAUNCH : ERR_ALPHA
        const e =
          errSmoothRef.current === Number.NEGATIVE_INFINITY
            ? rawErr
            : errAlpha * rawErr + (1 - errAlpha) * errSmoothRef.current
        errSmoothRef.current = e
        let corr = !launching && Math.abs(e) < ERR_DEADBAND_WORDS ? 0 : e
        // Approaching a paragraph end, never SLOW below the steady pace: the eyeline
        // is meant to run ahead into the gap, so a negative error here is the coming
        // gap, not the reader lagging. (Speeding UP to hold the box is still allowed.)
        const nearGap = wordsLeftInBlock(tokens, eyelineIndex) <= LEAD_WORDS + 2
        if (nearGap) corr = Math.max(0, corr)
        target = pace + KP_WPM_PER_WORD * corr
      }
    } else if (idleMs < HOLD_MS) {
      // --- Glide: a brief quiet (comma/period micro-pause, or the gap between
      // recognition bursts). The reader is almost certainly still going, so KEEP
      // ROLLING at the steady average rather than stalling and then surging when the
      // next burst lands. We freeze the position feedback (don't touch errSmooth) so
      // it resumes without a spike, and skip the pause from the pace average.
      wpmRef.current.noteGap()
      target = pace
    } else {
      // --- Hold: a genuine, sustained stop → glide onto the word and wait. --------
      wpmRef.current.noteGap()
      target =
        aligner.index >= 0 && eyelineIndex >= 0
          ? KP_WPM_PER_WORD * clampWith(aligner.index - eyelineIndex, ERROR_CLAMP_WORDS)
          : 0
    }

    driveScroll(target)
  }

  const start = useCallback(
    async (kind: RecognizerKind, deviceId?: string) => {
      if (!enabled) return
      setState((s) => ({ ...s, status: 'Starting…', error: null }))
      useNotesStore.getState().startTake()
      const tokens = tokensFromDoc(useStore.getState().doc)
      tokensRef.current = tokens
      alignerRef.current = new Aligner(tokens, cfgRef.current)

      // Seed the pace from the project WPM as a starting guess; the cold-start
      // warmup in WpmEstimator then converges to the reader's real pace within
      // ~a sentence, so no separate calibration pass is needed.
      const seed = Math.max(80, useStore.getState().settings.wpm || DEFAULT_SEED_WPM)
      cruisePaceRef.current = seed
      wpmRef.current.reset(seed, nowMs())
      smoothWpmRef.current = seed
      lastAppliedWpmRef.current = -1
      errSmoothRef.current = Number.NEGATIVE_INFINITY
      launchWordsRef.current = 0
      launchingRef.current = false
      coastingRef.current = false
      coastEndRef.current = -1
      lastSpeechRef.current = nowMs()
      useStore.getState().setVoiceActive(true)

      // Lightly SKIM past any leading title/heading/question to the first real
      // sentence (from wherever the operator currently is), so the reader can
      // take it in before delivering — rather than an abrupt jump.
      const curWid = useStore.getState().currentEyelineWid
      const curIdx = curWid ? Math.max(0, tokens.findIndex((t) => t.wid === curWid)) : 0
      let skimTarget = curIdx
      while (skimTarget < tokens.length && !tokens[skimTarget].isReading) skimTarget++
      if (skimTarget >= tokens.length) skimTarget = curIdx // no reading found → no skim
      alignerRef.current.syncToIndex(curIdx)
      skimmingRef.current = skimTarget > curIdx
      skimTargetRef.current = skimTarget
      skimPaceRef.current = Math.min(seed, 120) // gentle, readable skim
      // Hold until the reader actually starts (so it can't run ahead on a pause);
      // the pace is pre-seeded, so the instant they speak it rolls at ~seed with
      // no stagnation, then evens out to their measured pace.
      speechStartedRef.current = false
      manualUntilRef.current = 0

      const rec = await createRecognizer(kind, (reason) =>
        setState((s) => ({ ...s, error: reason })),
      )
      rec.onWord((w) => handleWord(w.word, w.confidence, w.timestamp))
      rec.onError((m) => setState((s) => ({ ...s, error: m })))
      try {
        await rec.start(deviceId)
      } catch (e) {
        // Start failed (e.g. mic unavailable): unwind the "active" state we
        // optimistically set above, otherwise the store stays voiceActive:true
        // (question auto-hold disabled, any "listening" UI stuck on) forever.
        rec.stop()
        useStore.getState().setVoiceActive(false)
        setState((s) => ({ ...s, status: 'Idle', error: (e as Error).message }))
        return
      }
      recognizerRef.current = rec

      // Run the position-feedback control loop while tracking (fast tick = low lag).
      idleTimerRef.current = window.setInterval(controlTick, 120)

      setState((s) => ({
        ...s,
        active: true,
        kind: rec.kind,
        streamsOffDevice: rec.streamsAudioOffDevice,
        status: 'Matching your pace',
      }))
    },
    [handleWord, enabled],
  )

  const stop = useCallback(() => {
    recognizerRef.current?.stop()
    recognizerRef.current = null
    if (idleTimerRef.current) window.clearInterval(idleTimerRef.current)
    idleTimerRef.current = undefined
    lastAppliedWpmRef.current = -1
    smoothWpmRef.current = -1
    coastingRef.current = false
    coastEndRef.current = -1
    speechStartedRef.current = false
    useStore.getState().setVoiceActive(false)
    setState((s) => ({ ...s, active: false, status: 'Idle', estimatedWpm: 0 }))
  }, [])

  const setAllowBacktrack = useCallback((allow: boolean) => {
    cfgRef.current.allowBacktrack = allow
    setState((s) => ({ ...s, allowBacktrack: allow }))
    const a = alignerRef.current
    if (a) {
      const wid = a.currentWid
      const na = new Aligner(tokensFromDoc(useStore.getState().doc), cfgRef.current)
      na.syncToWid(wid)
      alignerRef.current = na
    }
  }, [])

  useEffect(
    () => () => {
      recognizerRef.current?.stop()
      if (idleTimerRef.current) window.clearInterval(idleTimerRef.current)
      useStore.getState().setVoiceActive(false)
    },
    [],
  )

  return { state, start, stop, setAllowBacktrack }
}
