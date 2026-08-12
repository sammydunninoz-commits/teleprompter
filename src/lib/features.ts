/**
 * Build-time feature switches.
 *
 * These gate whole surfaces of the operator UI. Code behind a disabled flag is
 * kept intact and still typechecks — it is simply never mounted — so turning a
 * feature back on is a one-line change here, not a re-implementation.
 */
export const FEATURES = {
  /**
   * Voice-following speed match (src/voice/*, VoicePanel).
   *
   * Switched OFF: the Voice tab is hidden and the recogniser is never
   * constructed, so the app never asks for microphone permission. The whole
   * subsystem — aligner, WPM estimator, recognisers — is still here and still
   * compiled; flip this to `true` to bring the tab back.
   */
  voice: false,

  /** Phone remote over WebRTC (src/remote/*). */
  remote: true,
} as const
