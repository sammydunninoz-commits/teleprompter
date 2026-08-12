/**
 * Estimates the speaker's reading pace as a STABLE AVERAGE of their actual
 * word-to-word timing.
 *
 * Key properties (per operator feedback):
 *  - It averages the interval between successive spoken words, so it reflects
 *    genuine reading speed — "listen until each word is spoken".
 *  - Pauses (gaps longer than `pauseMs`, e.g. between paragraphs) are EXCLUDED,
 *    so a break never drags the average down or makes the scroll slow/speed.
 *  - Recogniser bursts (several words at almost the same instant) are excluded
 *    too, so they don't inflate it.
 *  - It can be pre-seeded (from the Test button) so the pace is right from the
 *    very first line.
 */
export class WpmEstimator {
  private emaIntervalMs = 0 // smoothed ms-per-word; 0 = not yet measured
  private lastTs = 0
  private seedWpm = 0
  private samples = 0 // accepted intervals since reset — drives cold-start warmup

  constructor(
    private minGapMs = 80, // below this = burst duplicate, ignore
    private pauseMs = 1500, // above this = a pause, ignore (don't lower the average)
    private alpha = 0.12, // steady-state interval smoothing — low = steady average
    private minWpm = 50,
    private maxWpm = 300,
  ) {}

  /** Feed one accepted (forward) word at time `ts`. Returns the current average. */
  advance(_index: number, ts: number): number {
    if (this.lastTs > 0) {
      const dt = ts - this.lastTs
      if (dt >= this.minGapMs && dt <= this.pauseMs) {
        this.samples++
        // COLD-START WARMUP: for the first several words behave like a true
        // running mean (effAlpha = 1/(n+1)), so the estimate converges to the
        // real pace within ~a sentence instead of crawling out of the seed. Once
        // 1/(n+1) drops below the steady alpha, we settle into the steady EMA.
        const effAlpha = Math.max(this.alpha, 1 / (this.samples + 1))
        this.emaIntervalMs =
          this.emaIntervalMs > 0 ? effAlpha * dt + (1 - effAlpha) * this.emaIntervalMs : dt
      }
    }
    this.lastTs = ts
    return this.current()
  }

  /** Pauses must NOT change the average — just return it unchanged. */
  idle(_ts: number): number {
    return this.current()
  }

  /** Forget the last word's timestamp so the interval that SPANS a pause/gap is
   *  not counted into the average. Call this while paused/coasting so that when
   *  the reader resumes, their first word doesn't register as one very slow word
   *  and drag the pace down — a paragraph wait must leave the WPM untouched. */
  noteGap(): void {
    this.lastTs = 0
  }

  current(): number {
    const wpm = this.emaIntervalMs > 0 ? 60000 / this.emaIntervalMs : this.seedWpm
    return Math.min(this.maxWpm, Math.max(this.minWpm, wpm || this.seedWpm || this.minWpm))
  }

  /** Reset, optionally seeding the average with a measured/known pace. */
  reset(seedWpm = 0, _ts = 0): void {
    this.seedWpm = seedWpm
    this.emaIntervalMs = seedWpm > 0 ? 60000 / seedWpm : 0
    this.lastTs = 0
    this.samples = 0
  }
}
