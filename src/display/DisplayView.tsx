import { useEffect, useLayoutEffect, useRef } from 'react'
import type { JSONContent } from '@tiptap/core'
import type { DisplayConfig } from '../store/types'
import { renderDocToHtml } from '../editor/renderDoc'
import { offsetAt, nowMs } from '../scroll/transport'
import { useStore } from '../store/useStore'

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

/**
 * A single prompter surface. Renders the shared document, then drives a
 * transform-based, rAF-driven scroll from transport state — deriving its own
 * offset every frame (never a pushed per-frame position). Reused as the
 * operator preview now and as a spawned display window in Phase 2.
 */
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

  const liveHighlightWid = useStore((s) => s.liveHighlightWid)

  // --- Render document HTML on doc change, anchoring to the eyeline word ---
  useLayoutEffect(() => {
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!content || !viewport) return

    // Capture which word sits at the eyeline BEFORE re-rendering, so an edit
    // above the current position doesn't yank the talent's place.
    const eyelineY = viewport.clientHeight * config.eyelineFrac
    const anchorBefore = wordNearestY(content, eyelineY)

    content.innerHTML = renderDocToHtml(doc, {
      showQuestions: config.showQuestions,
      // Operator preview forces notes on; talent windows fall back to their
      // (always-false) per-display setting — a director note can never leak.
      showNotes: showNotesOverride ?? config.showNotes,
      questionColor,
    })

    measure(content, viewport)

    // Re-anchor: shift transport so the same word returns to the eyeline.
    if (anchorBefore && anchorOnEdit) {
      const el = content.querySelector<HTMLElement>(
        `[data-wid="${cssEscape(anchorBefore.wid)}"]`,
      )
      if (el) {
        const targetOffset =
          el.offsetTop + el.offsetHeight / 2 - eyelineY + anchorBefore.within
        useStore.getState().scrubTo(clampOffset(targetOffset))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, docVersion, config.showQuestions, config.showNotes, questionColor, showNotesOverride])

  // --- Measure on resize ---
  useEffect(() => {
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!content || !viewport) return
    const ro = new ResizeObserver(() => measure(content, viewport))
    ro.observe(viewport)
    ro.observe(content)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.fontSizePx, config.lineHeight, config.maxLineCh])

  function measure(content: HTMLDivElement, viewport: HTMLDivElement) {
    const viewportH = viewport.clientHeight
    const eyelineY = viewportH * config.eyelineFrac
    const wordEls = content.querySelectorAll<HTMLElement>('.word')
    // Vertically CENTRE the first line on the eyeline (so it sits in the middle
    // of the focus box at the start, not its lower half). We use the word's true
    // centre relative to the content padding-box — which includes line-box
    // leading, so it's exact — rather than assuming top == padding.
    const curPadTop = parseFloat(content.style.paddingTop) || 0
    const firstCentre = wordEls.length
      ? wordEls[0].offsetTop + wordEls[0].offsetHeight / 2 - curPadTop
      : (config.fontSizePx * config.lineHeight) / 2
    const topPad = Math.max(0, eyelineY - firstCentre)
    // Bottom padding is a full viewport of runway so the last line can travel
    // all the way up to the eyeline.
    const botPad = viewportH
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
    // the eyeline. Blocks are identified by the wid prefix (blockId#index), so
    // this follows the document's real structure rather than guessing from line
    // wrapping — a wrapped paragraph is still one entry. Drives "back a
    // paragraph"; see the autocue:prevpara handler below.
    const paraStarts: number[] = []
    let lastBlock: string | null = null
    wordEls.forEach((w) => {
      const block = (w.dataset.wid ?? '').split('#')[0]
      if (!block || block === lastBlock) return
      lastBlock = block
      paraStarts.push(Math.max(0, w.offsetTop + w.offsetHeight / 2 - eyelineY))
    })
    paraStartsRef.current = paraStarts.sort((a, b) => a - b)

    // End-stop: scroll until the LAST line sits centred on the eyeline, so every
    // line — including the final paragraph — can be read at the middle. Derived
    // from the last word's real position, independent of padding.
    if (wordEls.length) {
      const last = wordEls[wordEls.length - 1]
      const lastCentre = last.offsetTop + last.offsetHeight / 2
      maxOffsetRef.current = Math.max(0, lastCentre - eyelineY)
    } else {
      maxOffsetRef.current = 0
    }
    // Publish the range so the operator's scrub bar knows the bounds.
    if (anchorOnEdit) useStore.getState().setMaxOffset(maxOffsetRef.current)

    // Report real word density (words per px of the readable body).
    const bodyH = Math.max(1, contentH - topPad - botPad)
    const words = wordEls.length
    onLayout?.(words / bodyH, words)
  }

  // --- rAF loop: derive offset from transport, apply transform ---
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const tick = () => {
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
        const eyelineY = (viewportRef.current?.clientHeight ?? 0) * config.eyelineFrac
        const near = wordNearestY(content, eyelineY)
        useStore.getState().setEyelineWid(near?.wid ?? null)
      }

      rafRef.current = requestAnimationFrame(tick)
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
  // Only the authoritative operator view resolves jumps → one scrubTo, broadcast.
  useEffect(() => {
    if (!anchorOnEdit) return
    const content = contentRef.current
    const viewport = viewportRef.current
    if (!content || !viewport) return
    const onJump = (e: Event) => {
      const wid = (e as CustomEvent<{ wid: string }>).detail?.wid
      if (!wid) return
      const el = content.querySelector<HTMLElement>(`[data-wid="${cssEscape(wid)}"]`)
      if (!el) return
      const eyelineY = viewport.clientHeight * config.eyelineFrac
      const target = el.offsetTop + el.offsetHeight / 2 - eyelineY
      useStore.getState().scrubTo(clampOffset(target))
    }
    window.addEventListener('autocue:jumpwid', onJump as EventListener)
    return () => window.removeEventListener('autocue:jumpwid', onJump as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorOnEdit, config.eyelineFrac, docVersion])

  // --- Back a paragraph ---
  // Behaves like a "previous track" button: it first sends you to the top of the
  // paragraph you are in, which is what you want after a stumble. Press it again
  // (or press it when already at the top) and you go to the paragraph before.
  // The tolerance stops a press landing you a pixel above the start and reading
  // as "already there".
  useEffect(() => {
    if (!anchorOnEdit) return
    const onPrevPara = () => {
      const starts = paraStartsRef.current
      if (!starts.length) return
      const current = offsetAt(useStore.getState().transport, nowMs())
      const TOL = 12
      // Last start strictly above the current position, ignoring one we are
      // effectively already parked on.
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
    // Stop when the last line reaches the eyeline (not when the content box
    // reaches the viewport bottom), so the whole script passes the eyeline.
    return Math.min(Math.max(0, off), maxOffsetRef.current)
  }

  // --- Transforms for beam-splitter rigs / mounting orientation ---
  const flips = [
    config.mirrorH ? 'scaleX(-1)' : '',
    config.flipV ? 'scaleY(-1)' : '',
    config.rotate180 ? 'rotate(180deg)' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const eyelineY = `${config.eyelineFrac * 100}%`

  return (
    <div
      ref={viewportRef}
      className={`relative overflow-hidden bg-black ${className ?? ''}`}
      style={{ transform: flips || undefined }}
      onClick={(e) => {
        if (!onWordClick) return
        const target = e.target as HTMLElement
        const wid = target.closest<HTMLElement>('.word')?.dataset.wid
        if (wid) onWordClick(wid)
      }}
      onWheel={
        anchorOnEdit
          ? (e) => {
              // Manual scrub with the wheel — reposition without changing WPM.
              const cur = offsetAt(useStore.getState().transport, nowMs())
              useStore.getState().scrubTo(clampOffset(cur + e.deltaY))
            }
          : undefined
      }
    >
      {/* Moving content */}
      <div
        ref={contentRef}
        className="prompter-doc will-change-transform"
        style={{
          fontSize: config.fontSizePx,
          lineHeight: config.lineHeight,
          paddingLeft: `${config.marginXFrac * 100}%`,
          paddingRight: `${config.marginXFrac * 100}%`,
          maxWidth: '100%',
          // max line length in ch, centered within the margins
          ...(config.maxLineCh
            ? { ['--max-ch' as string]: `${config.maxLineCh}ch` }
            : {}),
          transform: 'translate3d(0,0,0)',
        }}
      />

      {/* Eyeline indicator */}
      {config.eyelineStyle === 'line' && (
        <div
          className="pointer-events-none absolute left-0 right-0"
          style={{ top: eyelineY, borderTop: '2px solid rgba(59,130,246,0.7)' }}
        />
      )}
      {config.eyelineStyle === 'arrows' && (
        <>
          <div
            className="pointer-events-none absolute text-accent"
            style={{ top: `calc(${eyelineY} - 0.5em)`, left: 8, fontSize: '1.5rem' }}
          >
            ▶
          </div>
          <div
            className="pointer-events-none absolute text-accent"
            style={{ top: `calc(${eyelineY} - 0.5em)`, right: 8, fontSize: '1.5rem' }}
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

      {/* Focus box (Imaginary Teleprompter style): a clear reading band at the
          eyeline framed by solid dimmed flaps above and below. Keeps the
          interviewee's eye pinned to one line for steady eye contact. */}
      {config.eyelineStyle === 'box' &&
        (() => {
          const bandPx = config.focusBoxHeightEm * config.fontSizePx
          const dim = config.eyelineGradientIntensity
          const topEdge = `calc(${config.eyelineFrac * 100}% - ${bandPx / 2}px)`
          const bottomEdge = `calc(${config.eyelineFrac * 100}% + ${bandPx / 2}px)`
          return (
            <>
              {/* dimmed flaps (hard-edged, like Imaginary's overlay rows) */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `linear-gradient(to bottom,
                    rgba(0,0,0,${dim}) 0, rgba(0,0,0,${dim}) ${topEdge},
                    rgba(0,0,0,0) ${topEdge}, rgba(0,0,0,0) ${bottomEdge},
                    rgba(0,0,0,${dim}) ${bottomEdge}, rgba(0,0,0,${dim}) 100%)`,
                }}
              />
              {/* subtle frame lines marking the clear band edges */}
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

      {/* Blackout */}
      {config.blackout && <div className="absolute inset-0 bg-black" />}
    </div>
  )
}

/** Find the word span nearest a given viewport Y, in content-local coords. */
function wordNearestY(
  content: HTMLElement,
  eyelineY: number,
): { wid: string; within: number } | null {
  const words = content.querySelectorAll<HTMLElement>('.word')
  if (words.length === 0) return null
  // current transform offset:
  const m = /translate3d\(0px,\s*(-?[\d.]+)px/.exec(content.style.transform)
  const offset = m ? -Number(m[1]) : 0
  let best: HTMLElement | null = null
  let bestDist = Infinity
  words.forEach((w) => {
    // Compare the word's vertical CENTRE to the eyeline (lines are centred).
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
