import { useEffect, useState } from 'react'
import { remoteUrlFor, type PeerHostState } from '../remote/usePeerHost'

/**
 * Operator panel for the phone remote: starts a pairing session and renders the
 * QR code the phone scans. The session (and therefore the pairing code) is
 * deliberately short-lived — it dies with the peer when the operator stops it or
 * leaves Prompt mode, so an old QR photo can't be used to grab the transport.
 */
export default function RemotePanel({
  state,
  start,
  stop,
}: {
  state: PeerHostState
  start: () => void
  stop: () => void
}) {
  const url = state.code ? remoteUrlFor(state.code) : null

  return (
    <div className="thin-scroll flex h-full flex-col overflow-auto p-4 text-sm">
      <p className="mb-3 text-xs leading-relaxed text-neutral-400">
        Control speed, play/pause and position from a phone. Scan the code below, or open the
        link on any device on any network.
      </p>

      {state.status === 'idle' && (
        <button
          onClick={start}
          className="rounded bg-accent px-3 py-2 text-sm font-medium text-white hover:brightness-110"
        >
          Start remote session
        </button>
      )}

      {state.status === 'starting' && (
        <div className="text-xs text-neutral-500">Opening a pairing session…</div>
      )}

      {state.status === 'error' && (
        <div className="rounded border border-red-900/60 bg-red-950/40 p-3 text-xs text-red-300">
          <div className="font-medium">Couldn’t start the remote</div>
          <div className="mt-1 text-red-400/80">{state.error}</div>
          <button onClick={start} className="mt-2 rounded border border-edge px-2 py-1 hover:bg-edge">
            Retry
          </button>
        </div>
      )}

      {url && (state.status === 'waiting' || state.status === 'connected') && (
        <>
          <div className="mx-auto rounded-lg bg-white p-3">
            <QrCode text={url} size={188} />
          </div>

          <div className="mt-3 text-center">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Pairing code</div>
            <div className="font-mono text-lg tracking-[0.2em] text-neutral-100">{state.code}</div>
          </div>

          <div
            className={`mt-3 flex items-center justify-center gap-2 rounded border px-3 py-2 text-xs ${
              state.peers > 0
                ? 'border-green-900/60 bg-green-950/30 text-green-300'
                : 'border-edge bg-panelalt text-neutral-400'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                state.peers > 0 ? 'bg-green-500' : 'bg-neutral-600'
              }`}
            />
            {state.peers > 0
              ? `${state.peers} remote${state.peers > 1 ? 's' : ''} connected`
              : 'Waiting for a phone to pair…'}
          </div>

          <label className="mt-3 block text-xs text-neutral-500">
            Link
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-1 w-full rounded border border-edge bg-panel px-2 py-1.5 text-xs text-neutral-300"
            />
          </label>

          <button
            onClick={stop}
            className="mt-4 rounded border border-edge px-3 py-2 text-xs text-neutral-300 hover:bg-edge"
          >
            End remote session
          </button>

          <p className="mt-4 text-[11px] leading-relaxed text-neutral-500">
            Anyone with this code can drive the prompter while the session is open. Pairing goes
            through the public PeerJS broker, so both devices need internet — commands themselves
            travel directly phone-to-console.
          </p>
        </>
      )}
    </div>
  )
}

/**
 * QR rendered to a data URL. The `qrcode` module is pulled in on demand: it is
 * only ever needed on this panel, and the operator console's first paint should
 * not pay for it.
 */
function QrCode({ text, size }: { text: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSrc(null)
    setFailed(false)
    import('qrcode')
      .then((QR) =>
        QR.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: 'M' }),
      )
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [text, size])

  if (failed) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center p-2 text-center text-[11px] text-neutral-600"
      >
        Couldn’t draw the QR code — use the link or pairing code below.
      </div>
    )
  }

  return src ? (
    <img src={src} width={size} height={size} alt="QR code to open the phone remote" />
  ) : (
    <div style={{ width: size, height: size }} />
  )
}
