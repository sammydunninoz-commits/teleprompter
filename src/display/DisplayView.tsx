import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import type { DisplayConfig } from '../store/types'
import { renderDocToHtml } from '../editor/renderDoc'
import { offsetAt, nowMs } from '../scroll/transport'
import { applyTransportCommand, WPM_WHEEL_STEP } from '../scroll/commands'
import { useStore } from '../store/useStore'

/**
 * Fixed logical "scene". EVERY prompter surface — the operator's prompt preview
 * and every spawned display window — renders the script into this identical
 * canvas and then scales it to fit its own screen (letterboxing the remainder).
 *
 * This is what makes the eyeline line up across monitors: because the layout
 * (line wrapping, word positions, eyeline height, scroll bounds) is computed in
 * these fixed scene pixels rather than each window's own resolution, the SAME
 * word sits on the eyeline everywhere, and a scroll-back lands on the same line
 * on all of them. On a screen whose shape differs there's simply less runway top
 * and bottom — but the reading line is always mirrored exactly.
 */
const SCENE_W = 1920
const SCENE_H = 1080

interface Props {
  doc: JSONContent
  docVersion: number
  config: DisplayConfig
  questionColor: string
  /** Report measured layout back so WPM→px/s uses real word density. */
  onLayout?: (wordsPerPx: number, totalWords: number) => void
  /** Called when the scroll engine auto-holds at the end of a question block. */
  onAutoHold?: (offset: number) => void
  /** Operator preview lets the director see notes; talent windows never do. */
  showNotesOverride?: boolean
  /** Click a word to toggle a live highlight (operator preview only). */
  onWordClick?: (wid: string) => void
  /**
   * Only the operator's authoritative prompt view re-anchors position on edits
   * (and broadcasts the correction). Previews and display windows must not — a
   * display re-anchoring itself would fight the shared transport.
   */
  anchorOnEdit?: boolean
  className?: string
}

export default function DisplayView({
  doc,
  docVersion,
  config,
  questionColor,
  onLayout,
  onAutoHold,
  showNotesOverride,
  onWordClick,
  anchorOnEdit,
  className,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number>(0)
  const maxOffsetRef = useRef<number>(0)
  const lastEyelineReportRef = useRef<number>(0)
  const stopsRef = useRef<number[]>([])
  /** Scroll offset that puts each paragraph's first word on the eyeline. */
  const paraStartsRef = useRef<number[]>([])
  const armedOffsetRef = useRef<number>(0)
  const lastWidRef = useRef<string | null>(null)

  /** Uniform scale that fits the fixed scene into this window (contain). */
  const [scale, setScale] = useState(1)

  const liveHighlightWid = useStore((s) => s.liveHighlightWid)

  const eyelineScenePx = SCENE_H * config.eyelineFrac

  // --- Keep the scene scaled to fit the window (recompute on resize) ---
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const update = () => {
      const k = Math.min(vp.clientWidth / SCENE_W, vp.clientHeight / SCENE_H)
      setScale(k > 0 && Number.isFinite(k) ? k : 1)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [])

  // --- Render document HTML on doc change, anchoring to the eyeline word ---
  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return

    // Capture which word sits at the eyeline BEFORE re-rendering, so an edit
    // above the current position doesn't yank the talent's place.
    const anchorBefore = wordNearestY(content, eyelineScenePx)

    content.innerHTML = renderDocToHtml(doc, {
      showQuestions: config.showQuestions,
      // Operator preview forces notes on; talent windows fall back to their
      // (always-false) per-display setting — a director note can never leak.
      showNotes: showNotesOverride ?? config.showNotes,
      questionColor,
    })

    measure(content)

    // Re-anchor: shift transport so the same word returns to the eyeline.
    if (anchorBefore && anchorOnEdit) {
      const el = content.querySelector<HTMLElement>(
        `[data-wid="${cssEscape(anchorBefore.wid)}"]`,
      )
      if (el) {
        const targetOffset =
          el.offsetTop + el.offsetHeight / 2 - eyelineScenePx + anchorBefore.within
        useStore.getState().scrubTo(clampOffset(targetOffset))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, docVersion, config.showQuestions, config.showNotes, questionColor, showNotesOverride])

  // --- Re-measure when the scene layout (font/line/width) changes ---
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const ro = new ResizeObserver(() => measure(content))
    ro.observe(content)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.fontSizePx, config.lineHeight, config.maxLineCh])

  // Measurements are in SCENE pixels: the content lives inside the fixed-size
  // stage, and CSS transforms (the scale) never affect offsetTop/scrollHeight —
  // so every window measures the same numbers and stays word-for-word in sync.
  function measure(content: HTMLDivElement) {
    const eyelineY = eyelineScenePx
    const wordEls = content.querySelectorAll<HTMLElement>('.word')
    const curPadTop = parseFloat(content.style.paddingTop) || 0
    const firstCentre = wordEls.length
      ? wordEls[0].offsetTop + wordEls[0].offsetHeight / 2 - curPadTop
      : (config.fontSizePx * config.lineHeight) / 2
    const topPad = Math.max(0, eyelineY - firstCentre)
    // A full scene of runway so the last line can travel up to the eyeline.
    const botPad = SCENE_H
    content.style.paddingTop = `${topPad}px`
    content.style.paddingBottom = `${botPad}px`

    const contentH = content.scrollHeight

    // Stops = bottom of each question block (auto-hold points).
    const stops: number[] = []
    content.querySelectorAll<HTMLElement>('.pt-question').forEach((q) => {
      stops.push(q.offsetTop + q.offsetHeight - topPad)
    })
    stopsRef.current = stops.sort((a, b) => a - b)

    // Paragraph starts = the scroll offset that puts each block's FIRST word on
    // the eyeline (drives "back a paragraph").
    const paraStarts: number[] = []
    let lastBlock: string | null = null
    wordEls.forEach((w) => {
      const block = (w.dataset.wid ?? '').split('#')[0]
      if (!block || block === lastBlock) return
      lastBlock = block
      paraStarts.push(Math.max(0, w.offsetTop + w.offsetHeight / 2 - eyelineY))
    })
    paraStartsRef.current = paraStarts.sort((a, b) => a - b)

    // End-stop: scroll until the LAST line sits centred on the eyeline.
    if (wordEls.length) {
      const last = wordEls[wordEls.length - 1]
      const lastCentre = last.offsetTop + last.offsetHeight / 2
      maxOffsetRef.current = Math.max(0, lastCentre - eyelineY)
    } else {
      maxOffsetRef.current = 0
    }
    // Publish the range so the operator's scrub bar knows the bounds.
    if (anchorOnEdit) useStore.getState().setMaxOffset(maxOffsetRef.current)

    // Report real word density (words per scene-px of the readable body).
    const bodyH = Math.max(1, contentH - topPad - botPad)
    const words = wordEls.length
    onLayout?.(words / bodyH, words)
  }

  // --- rAF loop: derive offset from transport, apply transform ---
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const tick = () => {
      // Guarded and ALWAYS reschedules in `finally`: a single thrown frame must
      // never kill the loop, or the talent display would freeze with no recovery.
      try {
        const t = useStore.getState().transport
        let off = offsetAt(t, nowMs())
        off = clampOffset(off)

        // Auto-hold at question ends — but NOT during voice tracking, which coasts
        // through questions at the reader's pace instead of stopping.
        if (t.playing && onAutoHold && !useStore.getState().voiceActive) {
          for (const stop of stopsRef.current) {
            if (stop > armedOffsetRef.current && off >= stop) {
              off = stop
              onAutoHold(stop)
              break
            }
          }
        }

        content.style.transform = `translate3d(0, ${-off}px, 0)`

        // Authoritative view publishes the eyeline word (throttled) so the voice
        // aligner can resync after a manual scrub.
        if (anchorOnEdit && nowMs() - lastEyelineReportRef.current > 120) {
          lastEyelineReportRef.current = nowMs()
          const near = wordNearestY(content, eyelineScenePx)
          useStore.getState().setEyelineWid(near?.wid ?? null)
        }
      } catch (err) {
        console.error('[autocue] scroll frame error (loop continues):', err)
      } finally {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When playback (re)starts, arm stops that are strictly ahead of us.
  const transportSeq = useStore((s) => s.transport.seq)
  const playing = useStore((s) => s.transport.playing)
  useEffect(() => {
    if (playing) {
      armedOffsetRef.current = offsetAt(useStore.getState().transport, nowMs())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transportSeq, playing])

  // --- Live highlight (saved-independent) ---
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    if (lastWidRef.current) {
      content
        .querySelector(`[data-wid="${cssEscape(lastWidRef.current)}"]`)
        ?.classList.remove('live-highlight')
    }
    if (liveHighlightWid) {
      content
        .querySelector(`[data-wid="${cssEscape(liveHighlightWid)}"]`)
        ?.classList.add('live-highlight')
    }
    lastWidRef.current = liveHighlightWid
  }, [liveHighlightWid, docVersion])

  // --- Jump to a word by id (click-to-jump from notes / voice) ---
  useEffect(() => {
    if (!anchorOnEdit) return
    const content = contentRef.current
    if (!content) return
    const onJump = (e: Event) => {
      const wid = (e as CustomEvent<{ wid: string }>).detail?.wid
      if (!wid) return
      const el = content.querySelector<HTMLElement>(`[data-wid="${cssEscape(wid)}"]`)
      if (!el) return
      const target = el.offsetTop + el.offsetHeight / 2 - eyelineScenePx
      useStore.getState().scrubTo(clampOffset(target))
    }
    window.addEventListener('autocue:jumpwid', onJump as EventListener)
    return () => window.removeEventListener('autocue:jumpwid', onJump as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorOnEdit, config.eyelineFrac, docVersion])

  // --- Back a paragraph ---
  useEffect(() => {
    if (!anchorOnEdit) return
    const onPrevPara = () => {
      const starts = paraStartsRef.current
      if (!starts.length) return
      const current = offsetAt(useStore.getState().transport, nowMs())
      const TOL = 12
      let target = 0
      for (const s of starts) {
        if (s < current - TOL) target = s
        else break
      }
      useStore.getState().scrubTo(clampOffset(target))
    }
    window.addEventListener('autocue:prevpara', onPrevPara)
    return () => window.removeEventListener('autocue:prevpara', onPrevPara)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorOnEdit])

  function clampOffset(off: number): number {
    return Math.min(Math.max(0, off), maxOffsetRef.current)
  }

  // Beam-splitter / mounting orientation — applied to the whole scene.
  const flips = [
    config.mirrorH ? 'scaleX(-1)' : '',
    config.flipV ? 'scaleY(-1)' : '',
    config.rotate180 ? 'rotate(180deg)' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const eyelinePct = `${config.eyelineFrac * 100}%`
  const contentMaxWidth = config.maxLineCh ? `${config.maxLineCh}ch` : undefined

  return (
    <div
      ref={viewportRef}
      className={`relative overflow-hidden bg-black ${className ?? ''}`}
      onClick={(e) => {
        if (!onWordClick) return
        const target = e.target as HTMLElement
        const wid = target.closest<HTMLElement>('.word')?.dataset.wid
        if (wid) onWordClick(wid)
      }}
      onWheel={
        anchorOnEdit
          ? (e) => {
              // Mouse-wheel speed control (Imaginary-style): wheel up = faster,
              // down = slower. Position is unchanged; use the scrub bar / PageUp
              // to move within the script.
              const dir = e.deltaY < 0 ? 1 : -1
              applyTransportCommand({ type: 'wpm-step', delta: dir * WPM_WHEEL_STEP })
            }
          : undefined
      }
    >
      {/* The fixed scene, centred and scaled to fit this window. Everything inside
          is in scene pixels — identical on every screen. */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: SCENE_W,
          height: SCENE_H,
          overflow: 'hidden',
          background: '#000',
          transform: `translate(-50%, -50%) scale(${scale})${flips ? ` ${flips}` : ''}`,
        }}
      >
        {/* Moving content */}
        <div
          ref={contentRef}
          className="prompter-doc will-change-transform"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            marginLeft: 'auto',
            marginRight: 'auto',
            maxWidth: contentMaxWidth,
            fontSize: config.fontSizePx,
            lineHeight: config.lineHeight,
            transform: 'translate3d(0,0,0)',
            // Prompt mode / talent displays are pure animation — text can't be
            // selected or highlighted here; that's an edit-mode-only affordance.
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        />

        {/* Eyeline indicator */}
        {config.eyelineStyle === 'line' && (
          <div
            className="pointer-events-none absolute left-0 right-0"
            style={{ top: eyelinePct, borderTop: '2px solid rgba(59,130,246,0.7)' }}
          />
        )}
        {config.eyelineStyle === 'arrows' && (
          <>
            <div
              className="pointer-events-none absolute text-accent"
              style={{ top: `calc(${eyelinePct} - 0.5em)`, left: 8, fontSize: '1.5rem' }}
            >
              ▶
            </div>
            <div
              className="pointer-events-none absolute text-accent"
              style={{ top: `calc(${eyelinePct} - 0.5em)`, right: 8, fontSize: '1.5rem' }}
            >
              ◀
            </div>
          </>
        )}
        {config.eyelineStyle === 'gradient' && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `linear-gradient(to bottom,
                rgba(0,0,0,${config.eyelineGradientIntensity}) 0%,
                rgba(0,0,0,0) ${config.eyelineFrac * 100}%,
                rgba(0,0,0,${config.eyelineGradientIntensity}) 100%)`,
            }}
          />
        )}

        {/* Focus box: a clear reading band framed by dimmed flaps. */}
        {config.eyelineStyle === 'box' &&
          (() => {
            const bandPx = config.focusBoxHeightEm * config.fontSizePx
            const dim = config.eyelineGradientIntensity
            const topEdge = `calc(${config.eyelineFrac * 100}% - ${bandPx / 2}px)`
            const bottomEdge = `calc(${config.eyelineFrac * 100}% + ${bandPx / 2}px)`
            return (
              <>
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    background: `linear-gradient(to bottom,
                      rgba(0,0,0,${dim}) 0, rgba(0,0,0,${dim}) ${topEdge},
                      rgba(0,0,0,0) ${topEdge}, rgba(0,0,0,0) ${bottomEdge},
                      rgba(0,0,0,${dim}) ${bottomEdge}, rgba(0,0,0,${dim}) 100%)`,
                  }}
                />
                <div
                  className="pointer-events-none absolute left-0 right-0"
                  style={{ top: topEdge, borderTop: '1px solid rgba(255,255,255,0.18)' }}
                />
                <div
                  className="pointer-events-none absolute left-0 right-0"
                  style={{ top: bottomEdge, borderTop: '1px solid rgba(255,255,255,0.18)' }}
                />
              </>
            )
          })()}

        {/* Blackout (fills the scene; the letterbox around it is already black) */}
        {config.blackout && <div className="absolute inset-0 bg-black" />}
      </div>
    </div>
  )
}

/** Find the word span nearest a given content-Y (scene px), in content coords. */
function wordNearestY(
  content: HTMLElement,
  eyelineY: number,
): { wid: string; within: number } | null {
  const words = content.querySelectorAll<HTMLElement>('.word')
  if (words.length === 0) return null
  const m = /translate3d\(0px,\s*(-?[\d.]+)px/.exec(content.style.transform)
  const offset = m ? -Number(m[1]) : 0
  let best: HTMLElement | null = null
  let bestDist = Infinity
  words.forEach((w) => {
    const screenY = w.offsetTop + w.offsetHeight / 2 - offset
    const dist = Math.abs(screenY - eyelineY)
    if (dist < bestDist) {
      bestDist = dist
      best = w
    }
  })
  if (!best) return null
  const chosen = best as HTMLElement
  const wid = chosen.dataset.wid
  if (!wid) return null
  const screenY = chosen.offsetTop + chosen.offsetHeight / 2 - offset
  return { wid, within: eyelineY - screenY }
}

function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s)
  return s.replace(/["\\#.]/g, '\\$&')
}
