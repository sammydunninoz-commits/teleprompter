import type { Recognizer, RecognizedWord } from './recognizer'

/**
 * On-device speech recognition via Whisper (transformers.js) — the privacy-
 * preserving path: no audio leaves the machine. EXPERIMENTAL and optional.
 *
 * transformers.js is a large dependency and its model downloads once (~40MB),
 * so it is NOT bundled by default. Install it to enable this path:
 *
 *     npm i @huggingface/transformers
 *
 * The import below is written so the app builds and runs without the package;
 * selecting Whisper without it simply falls back to Web Speech.
 */
export class WhisperRecognizer implements Recognizer {
  readonly kind = 'whisper' as const
  readonly streamsAudioOffDevice = false

  private wordCb: (w: RecognizedWord) => void = () => {}
  private errCb: (m: string) => void = () => {}
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private processor: ScriptProcessorNode | null = null
  private buffer: Float32Array[] = []
  private bufferedSamples = 0
  private transcribe: ((audio: Float32Array) => Promise<{ text: string }>) | null = null
  private busy = false
  private running = false

  async start(deviceId?: string): Promise<void> {
    const pkg = '@huggingface/transformers'
    const mod = await import(/* @vite-ignore */ pkg).catch(() => {
      throw new Error('package @huggingface/transformers not installed')
    })
    const pipe = await mod.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en')
    this.transcribe = (audio: Float32Array) => pipe(audio)

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    })
    // 16 kHz matches Whisper's expected input; the context resamples for us.
    this.ctx = new AudioContext({ sampleRate: 16000 })
    const source = this.ctx.createMediaStreamSource(this.stream)
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1)
    source.connect(this.processor)
    this.processor.connect(this.ctx.destination)
    this.running = true

    const CHUNK = 16000 * 3 // ~3s windows
    this.processor.onaudioprocess = (e) => {
      if (!this.running) return
      this.buffer.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      this.bufferedSamples += e.inputBuffer.length
      if (this.bufferedSamples >= CHUNK && !this.busy) void this.flush()
    }
  }

  private async flush() {
    if (!this.transcribe || this.busy) return
    this.busy = true
    const merged = new Float32Array(this.bufferedSamples)
    let o = 0
    for (const b of this.buffer) {
      merged.set(b, o)
      o += b.length
    }
    this.buffer = []
    this.bufferedSamples = 0
    try {
      const { text } = await this.transcribe(merged)
      const ts = performance.timeOrigin + performance.now()
      for (const word of text.trim().split(/\s+/).filter(Boolean)) {
        this.wordCb({ word, confidence: 0.75, timestamp: ts, isFinal: true })
      }
    } catch (err) {
      this.errCb((err as Error).message)
    } finally {
      this.busy = false
    }
  }

  stop(): void {
    this.running = false
    this.processor?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.ctx?.close().catch(() => {})
    this.processor = null
    this.stream = null
    this.ctx = null
  }

  onWord(cb: (w: RecognizedWord) => void) {
    this.wordCb = cb
  }
  onError(cb: (m: string) => void) {
    this.errCb = cb
  }
}
