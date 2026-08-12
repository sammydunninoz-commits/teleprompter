import { useEffect, useState } from 'react'
import { listAudioInputs, type RecognizerKind } from '../voice/recognizer'
import type { useVoiceController } from '../voice/useVoiceController'

type Controller = ReturnType<typeof useVoiceController>

/** Voice-following auto-scroll controls (Feature 5). Opt-in per session. */
export default function VoicePanel({ controller }: { controller: Controller }) {
  const { state, start, stop, setAllowBacktrack } = controller
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  const [kind, setKind] = useState<RecognizerKind>('webspeech')

  useEffect(() => {
    listAudioInputs().then(setDevices).catch(() => {})
  }, [])

  return (
    <div className="thin-scroll flex h-full flex-col gap-3 overflow-auto p-4 text-sm">
      <p className="text-xs text-neutral-500">
        Just hit <b>Play</b> and start reading — it skips any title/question, begins at the first
        sentence, and locks onto your pace within a line or two, keeping your current line high in
        the focus box. It holds a steady average that rolls through paragraph gaps. Manual control
        always overrides.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-neutral-400">Recogniser</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as RecognizerKind)}
          disabled={state.active}
          className="rounded border border-edge bg-panelalt px-2 py-1"
        >
          <option value="webspeech">Web Speech (streams audio off-device)</option>
          <option value="whisper">Whisper — on-device (experimental)</option>
        </select>
      </label>

      {kind === 'webspeech' && (
        <p className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-300/90">
          ⚠ Web Speech sends microphone audio to the browser vendor’s servers. For fully
          on-device recognition, choose Whisper (needs <code>@huggingface/transformers</code>).
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-neutral-400">Microphone</span>
        <select
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          disabled={state.active}
          className="rounded border border-edge bg-panelalt px-2 py-1"
        >
          <option value="">Default (built-in mic)</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Mic ${d.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-2">
        <span className="text-neutral-300">Follow backtracks / retakes</span>
        <input
          type="checkbox"
          checked={state.allowBacktrack}
          onChange={(e) => setAllowBacktrack(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        {state.active ? (
          <button
            onClick={stop}
            className="rounded bg-red-600 px-4 py-1.5 text-white hover:brightness-110"
          >
            ⏹ Stop
          </button>
        ) : (
          <button
            onClick={() => start(kind, deviceId || undefined)}
            className="rounded bg-accent px-4 py-1.5 font-medium text-white hover:brightness-110"
          >
            ▶ Play
          </button>
        )}
      </div>

      <div className="rounded bg-panelalt px-3 py-2 text-xs">
        <div className="flex justify-between">
          <span className="text-neutral-500">Status</span>
          <span className={state.active ? 'text-green-400' : 'text-neutral-300'}>
            {state.status}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Matched speed</span>
          <span className="tabular-nums text-accent">{state.estimatedWpm} WPM</span>
        </div>
        <div className="flex justify-between">
          <span className="text-neutral-500">Words heard</span>
          <span className="tabular-nums">{state.wordsSeen}</span>
        </div>
        {state.error && <p className="mt-1 text-red-400">{state.error}</p>}
      </div>
    </div>
  )
}
