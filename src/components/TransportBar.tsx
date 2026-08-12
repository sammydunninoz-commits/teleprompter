import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import {
  estimateRuntimeSec,
  formatDuration,
  nowMs,
  offsetAt,
} from '../scroll/transport'

/**
 * Transport controls: play/pause with ease in/out (handled in CSS on the
 * button), WPM speed in real words-per-minute, and a live runtime countdown
 * derived from actual word count in view.
 */
export default function TransportBar() {
  const transport = useStore((s) => s.transport)
  const wpm = useStore((s) => s.settings.wpm)
  const totalWords = useStore((s) => s.totalWords)
  const wordsPerPx = useStore((s) => s.wordsPerPx)
  const play = useStore((s) => s.play)
  const pause = useStore((s) => s.pause)
  const setWpm = useStore((s) => s.setWpm)
  const scrubTo = useStore((s) => s.scrubTo)
  const maxOffset = useStore((s) => s.maxOffset)

  // Tick a few times a second so the countdown updates without a full rAF.
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [])

  const current = offsetAt(transport, nowMs())
  const wordsConsumed = Math.max(0, Math.min(totalWords, current * wordsPerPx))
  const wordsRemaining = Math.max(0, totalWords - wordsConsumed)
  const totalSec = estimateRuntimeSec(totalWords, wpm)
  const remainingSec = estimateRuntimeSec(wordsRemaining, wpm)

  function toggle() {
    if (transport.playing) pause(current)
    else play(current)
  }

  const clampedPos = Math.min(current, maxOffset || current)
  const pct = maxOffset > 0 ? Math.round((clampedPos / maxOffset) * 100) : 0

  return (
    <div className="flex flex-col border-t border-edge bg-panelalt">
      {/* Position scrubber — drag to reposition anywhere (e.g. back to a line
          after a stumble), without changing the speed. Also scroll the wheel
          over the prompter. */}
      <div className="flex items-center gap-3 px-4 pt-2">
        <span className="w-8 text-right text-xs tabular-nums text-neutral-500">{pct}%</span>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(maxOffset))}
          step={1}
          value={Math.round(clampedPos)}
          onChange={(e) => scrubTo(Number(e.target.value))}
          disabled={maxOffset <= 0}
          className="h-1.5 flex-1 accent-accent"
          title="Scrub through the script"
        />
      </div>

      <div className="flex items-center gap-4 px-4 py-3">
      <button
        onClick={toggle}
        className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-xl text-white transition hover:brightness-110"
        title="Play / Pause (Space)"
      >
        {transport.playing ? '❚❚' : '▶'}
      </button>

      <button
        onClick={() => scrubTo(0)}
        className="rounded px-2 py-1 text-sm text-neutral-300 hover:bg-edge"
        title="Back to top (Home)"
      >
        ⤒ Top
      </button>

      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-500">WPM</span>
        <input
          type="range"
          min={40}
          max={700}
          step={5}
          value={wpm}
          onChange={(e) => setWpm(Number(e.target.value))}
          className="w-40 accent-accent"
        />
        <span className="w-10 text-sm tabular-nums">{wpm}</span>
      </div>

      <div className="ml-auto flex items-center gap-6 text-sm tabular-nums text-neutral-300">
        <div title="Estimated time remaining at current WPM">
          <span className="text-neutral-500">Remaining </span>
          {formatDuration(remainingSec)}
        </div>
        <div title="Estimated total runtime">
          <span className="text-neutral-500">Total </span>
          {formatDuration(totalSec)}
        </div>
        <div>
          <span className="text-neutral-500">Words </span>
          {totalWords}
        </div>
      </div>
      </div>
    </div>
  )
}
