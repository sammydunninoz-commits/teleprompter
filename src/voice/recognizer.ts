export interface RecognizedWord {
  word: string
  confidence: number
  /** monotonic ms timestamp */
  timestamp: number
  isFinal: boolean
}

export type RecognizerKind = 'webspeech' | 'whisper'

export interface Recognizer {
  readonly kind: RecognizerKind
  /** True if audio leaves the device (privacy flag surfaced to the user). */
  readonly streamsAudioOffDevice: boolean
  start(deviceId?: string): Promise<void>
  stop(): void
  onWord(cb: (w: RecognizedWord) => void): void
  onError(cb: (message: string) => void): void
}

function nowMs(): number {
  return performance.timeOrigin + performance.now()
}

/**
 * Web Speech API recognizer — the immediately-working path. NOTE: this streams
 * audio to the browser vendor's servers; the UI flags that. Whisper-WASM (fully
 * on-device) is the privacy-preserving default when installed (see whisper.ts).
 */
export class WebSpeechRecognizer implements Recognizer {
  readonly kind = 'webspeech' as const
  readonly streamsAudioOffDevice = true
  private rec: any = null
  private wordCb: (w: RecognizedWord) => void = () => {}
  private errCb: (m: string) => void = () => {}
  private running = false
  private emittedForResult = 0

  async start(): Promise<void> {
    const Ctor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Ctor) throw new Error('Web Speech API not supported in this browser.')
    const rec = new Ctor()
    rec.continuous = true
    // Interim results ON for low latency — each recognised word is emitted as
    // soon as it appears (deduped), so position tracking stays responsive. The
    // controller closes the loop on position, so interim noise can't run away.
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.maxAlternatives = 1

    rec.onresult = (e: any) => {
      // Only the latest result is in progress; emit words from it not yet sent.
      const result = e.results[e.results.length - 1]
      const alt = result[0]
      const words: string[] = alt.transcript.trim().split(/\s+/).filter(Boolean)
      const isFinal = !!result.isFinal
      const confidence = isFinal ? alt.confidence || 0.7 : 0.6
      const ts = nowMs()
      for (let i = this.emittedForResult; i < words.length; i++) {
        this.wordCb({ word: words[i], confidence, timestamp: ts, isFinal })
      }
      // Reset the counter when the phrase finalises; otherwise remember how many
      // of the in-progress phrase we've already emitted.
      this.emittedForResult = isFinal ? 0 : words.length
    }
    rec.onerror = (e: any) => {
      // no-speech / aborted are normal and transient — let onend auto-restart.
      if (e.error === 'no-speech' || e.error === 'aborted') return
      // Everything else (not-allowed, service-not-allowed, audio-capture, …) is
      // fatal: STOP the auto-restart loop. Otherwise onend fires, sees running
      // === true, calls rec.start() again, which re-triggers the same error —
      // an infinite loop that pins the CPU when the mic is denied or absent.
      this.running = false
      this.errCb(`Speech recognition error: ${e.error}`)
    }
    rec.onend = () => {
      // Auto-restart while active (Web Speech stops itself periodically).
      if (this.running) {
        try {
          rec.start()
        } catch {
          /* already started */
        }
      }
    }
    this.rec = rec
    this.running = true
    rec.start()
  }

  stop(): void {
    this.running = false
    try {
      this.rec?.stop()
    } catch {
      /* ignore */
    }
    this.rec = null
  }

  onWord(cb: (w: RecognizedWord) => void) {
    this.wordCb = cb
  }
  onError(cb: (m: string) => void) {
    this.errCb = cb
  }
}

/**
 * Factory. Whisper is lazy-loaded and optional; if it isn't installed we fall
 * back to Web Speech and report why via onFallback.
 */
export async function createRecognizer(
  kind: RecognizerKind,
  onFallback?: (reason: string) => void,
): Promise<Recognizer> {
  if (kind === 'whisper') {
    try {
      const { WhisperRecognizer } = await import('./whisper')
      return new WhisperRecognizer()
    } catch (e) {
      onFallback?.(
        `On-device Whisper unavailable (${(e as Error).message}). Using Web Speech instead.`,
      )
      return new WebSpeechRecognizer()
    }
  }
  return new WebSpeechRecognizer()
}

/** List audio input devices for the picker (Feature 5). */
export async function listAudioInputs(): Promise<MediaDeviceInfo[]> {
  try {
    // Prompt once so labels populate.
    await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
      s.getTracks().forEach((t) => t.stop())
    })
  } catch {
    /* permission denied — still return whatever we can */
  }
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices.filter((d) => d.kind === 'audioinput')
}
