import { useCallback, useEffect, useRef, useState } from 'react'
import { useWakeLock } from '../hooks/useWakeLock'
import { formatDuration } from '../scroll/transport'
import { connectRelay, type BrokerId, type RelayLink } from './relay'
import {
  CONSOLE_TIMEOUT_MS,
  STALE_MS,
  WPM_MAX,
  WPM_MIN,
  WPM_STEP,
  type FailureStage,
  type RemoteCommand,
  type RemoteState,
} from './protocol'

type Phase = 'connecting' | 'live' | 'lost' | 'error'

interface Failure {
  stage: FailureStage
  /** PeerJS error type where there was one (e.g. 'peer-unavailable'). */
  code: string | null
  detail: string | null
}

/**
 * The handheld remote (rendered for `?remote=<code>`).
 *
 * This is a CONTROLLER surface, not a prompter: it never receives the script,
 * only transport state. It is built for one-handed use at arm's length in a
 * dark studio — hence the oversized hit targets and the absence of anything
 * that could be pressed by accident.
 */
export default function RemoteView({ code, brokerId }: { code: string; brokerId?: BrokerId }) {
  const [phase, setPhase] = useState<Phase>('connecting')
  const [failure, setFailure] = useState<Failure | null>(null)
  const [remote, setRemote] = useState<RemoteState | null>(null)
  /** Progress text while connecting, so a hang is legible rather than mute. */
  const [progress, setProgress] = useState('Reaching the signalling server…')

  const linkRef = useRef<RelayLink<RemoteState> | null>(null)
  /**
   * While the operator is dragging nothing and the phone is dragging a slider,
   * incoming snapshots would fight the thumb. We ignore the remote value for
   * the control being touched until shortly after release.
   */
  const holdWpmUntilRef = useRef(0)
  const holdScrubUntilRef = useRef(0)
  const [localWpm, setLocalWpm] = useState<number | null>(null)
  const [localScrub, setLocalScrub] = useState<number | null>(null)

  // A remote is useless if the phone sleeps mid-take.
  useWakeLock(true)

  useEffect(() => {
    let disposed = false
    let live = false
    let timer: number | undefined
    let hello: number | undefined
    let watchdog: number | undefined
    let lastSeen = 0

    const fail = (stage: FailureStage, code: string | null, detail: string | null) => {
      if (disposed || live) return
      window.clearTimeout(timer)
      setFailure({ stage, code, detail })
      setPhase('error')
    }

    async function connect() {
      let link: RelayLink<RemoteState>
      try {
        link = await connectRelay<RemoteState>(code, 'remote', brokerId)
      } catch (e) {
        fail('relay', 'connect-failed', (e as Error).message)
        return
      }
      if (disposed) {
        link.close()
        return
      }
      linkRef.current = link

      link.onMessage((msg) => {
        if (msg?.type !== 'state') return
        lastSeen = performance.now()
        if (!live) {
          live = true
          window.clearTimeout(timer)
          window.clearInterval(hello)
          setPhase('live')
        }
        setRemote(msg)
        const now = performance.now()
        if (now > holdWpmUntilRef.current) setLocalWpm(null)
        if (now > holdScrubUntilRef.current) setLocalScrub(null)
      })

      setProgress('Looking for the console…')

      // Announce ourselves and keep asking until answered: the console may not
      // have been listening at the instant we first spoke.
      const announce = () => link.send({ type: 'hello' })
      announce()
      hello = window.setInterval(announce, 1000)

      timer = window.setTimeout(() => {
        window.clearInterval(hello)
        fail('console', 'timeout', 'No console answered on this pairing code.')
      }, CONSOLE_TIMEOUT_MS)

      // MQTT gives no connection-level signal that the console went away, so
      // infer it from the snapshot stream drying up.
      watchdog = window.setInterval(() => {
        if (live && performance.now() - lastSeen > STALE_MS) setPhase('lost')
      }, 1000)
    }

    connect()
    return () => {
      disposed = true
      window.clearTimeout(timer)
      window.clearInterval(hello)
      window.clearInterval(watchdog)
      linkRef.current?.close()
      linkRef.current = null
    }
  }, [code, brokerId])

  const send = useCallback((cmd: RemoteCommand) => {
    linkRef.current?.send(cmd)
  }, [])

  if (phase !== 'live') {
    return <ConnectionScreen phase={phase} failure={failure} code={code} progress={progress} />
  }

  const playing = remote?.playing ?? false
  const wpm = localWpm ?? remote?.wpm ?? 150
  const maxOffset = remote?.maxOffset ?? 0
  const offset = localScrub ?? remote?.offset ?? 0
  const clamped = Math.min(offset, maxOffset || offset)
  const pct = maxOffset > 0 ? Math.round((clamped / maxOffset) * 100) : 0

  return (
    <div className="flex h-full flex-col bg-panel text-neutral-100">
      <header className="flex items-center gap-2 border-b border-edge px-4 py-2">
        <span className="text-sm font-semibold text-accent">autocue</span>
        <span className="min-w-0 flex-1 truncate text-sm text-neutral-400">
          {remote?.projectName ?? ''}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          Remote
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-5">
        {/* Countdown — the number the operator actually watches. */}
        <div className="flex items-baseline justify-center gap-6 tabular-nums">
          <div className="text-center">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Remaining</div>
            <div className="text-4xl font-semibold">{formatDuration(remote?.remainingSec ?? 0)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Total</div>
            <div className="text-2xl text-neutral-400">{formatDuration(remote?.totalSec ?? 0)}</div>
          </div>
        </div>

        {/* Speed — the primary control on this surface. */}
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wide text-neutral-500">Speed</span>
            <span className="text-2xl font-semibold tabular-nums">
              {wpm}
              <span className="ml-1 text-xs font-normal text-neutral-500">wpm</span>
            </span>
          </div>
          <input
            type="range"
            min={WPM_MIN}
            max={WPM_MAX}
            step={WPM_STEP}
            value={wpm}
            onChange={(e) => {
              const v = Number(e.target.value)
              setLocalWpm(v)
              holdWpmUntilRef.current = performance.now() + 600
              send({ type: 'wpm', wpm: v })
            }}
            className="h-3 w-full accent-accent"
            aria-label="Scroll speed in words per minute"
          />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <StepBtn onClick={() => send({ type: 'wpm', wpm: Math.max(WPM_MIN, wpm - 10) })}>
              − 10
            </StepBtn>
            <StepBtn onClick={() => send({ type: 'wpm', wpm: Math.min(WPM_MAX, wpm + 10) })}>
              + 10
            </StepBtn>
          </div>
        </div>

        {/* Position. */}
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wide text-neutral-500">Position</span>
            <span className="text-sm tabular-nums text-neutral-400">{pct}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.round(maxOffset))}
            step={1}
            value={Math.round(clamped)}
            disabled={maxOffset <= 0}
            onChange={(e) => {
              const v = Number(e.target.value)
              setLocalScrub(v)
              holdScrubUntilRef.current = performance.now() + 600
              send({ type: 'scrub', offset: v })
            }}
            className="h-3 w-full accent-accent disabled:opacity-40"
            aria-label="Position in the script"
          />
          <div className="mt-3 grid grid-cols-3 gap-3">
            <StepBtn onClick={() => send({ type: 'nudge', delta: -120 })}>↑ Back</StepBtn>
            <StepBtn onClick={() => send({ type: 'top' })}>⤒ Top</StepBtn>
            <StepBtn onClick={() => send({ type: 'nudge', delta: 120 })}>↓ Fwd</StepBtn>
          </div>
        </div>
      </div>

      {/* Play/pause pinned to the bottom, in reach of a thumb. */}
      <div className="border-t border-edge p-4">
        <button
          onClick={() => send({ type: 'toggle' })}
          className="flex h-20 w-full items-center justify-center gap-3 rounded-2xl bg-accent text-2xl font-semibold text-white transition active:brightness-90"
        >
          {playing ? '❚❚ Pause' : '▶ Play'}
        </button>
      </div>
    </div>
  )
}

function StepBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-edge bg-panelalt py-4 text-base text-neutral-200 active:bg-edge"
    >
      {children}
    </button>
  )
}

/** Plain-language cause and next step for each failure stage. */
const STAGE_HELP: Record<FailureStage, { title: string; body: string }> = {
  relay: {
    title: 'Couldn’t reach the relay',
    body: 'This phone can’t open a connection to the relay server — usually a captive-portal wifi that needs signing in to, or no data at all. Try mobile data, or re-join the wifi.',
  },
  console: {
    title: 'That pairing code isn’t active',
    body: 'The relay is fine, but no console answered on this code. The session was ended, or the QR is from an older one — start a new remote session on the console and re-scan.',
  },
}

function ConnectionScreen({
  phase,
  failure,
  code,
  progress,
}: {
  phase: Phase
  failure: Failure | null
  code: string
  progress: string
}) {
  const help = failure ? STAGE_HELP[failure.stage] : null

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-panel p-8 text-center text-neutral-300">
      <div className="text-sm font-semibold text-accent">autocue remote</div>

      {phase === 'connecting' && (
        <>
          <div className="text-lg">Connecting…</div>
          <div className="text-sm text-neutral-500">{progress}</div>
          <div className="text-xs text-neutral-600">Pairing code {code}</div>
        </>
      )}

      {phase === 'lost' && (
        <>
          <div className="text-lg">Disconnected</div>
          <p className="max-w-xs text-sm text-neutral-500">
            The console closed the session. Re-scan the QR code to pair again.
          </p>
        </>
      )}

      {phase === 'error' && help && (
        <>
          <div className="text-lg text-red-400">{help.title}</div>
          <p className="max-w-xs text-sm text-neutral-400">{help.body}</p>
          {/* Exact stage + error type, so a failure can be reported precisely
              rather than as "it didn't work". */}
          <p className="max-w-xs font-mono text-[11px] leading-relaxed text-neutral-600">
            stage: {failure!.stage}
            {failure!.code ? ` · ${failure!.code}` : ''}
            {failure!.detail ? <><br />{failure!.detail}</> : null}
          </p>
        </>
      )}

      {phase !== 'connecting' && (
        <button
          onClick={() => window.location.reload()}
          className="mt-2 rounded-lg border border-edge px-4 py-2 text-sm hover:bg-edge"
        >
          Try again
        </button>
      )}
    </div>
  )
}
