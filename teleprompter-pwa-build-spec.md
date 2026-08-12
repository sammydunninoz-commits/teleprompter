# Auto-cue Teleprompter PWA — build spec

## Purpose

A progressive web app for video production auto-cue teleprompting. Replaces "Imaginary Teleprompter" with: proper multi-monitor support, in-app text editing after import, question/reading-line distinction, word highlighting, voice-following auto-scroll, and director-only stumble notes.

Primary users: video production operators running a laptop connected to one or more prompter displays, cueing an interviewee/presenter through a pre-written script.

---

## Tech stack

- Vite + React + TypeScript
- TipTap (ProseMirror) for the script editor — custom schema, not raw contenteditable
- Zustand for app state
- Tailwind CSS for UI
- Dexie (IndexedDB wrapper) for local project storage
- File System Access API for saving/loading project files to disk
- mammoth.js for .docx import
- pdf.js for .pdf import (`getTextContent()`, expect a cleanup pass — PDF text extraction returns positioned fragments, not clean paragraphs)
- vite-plugin-pwa for service worker / offline support
- Whisper via WASM (whisper.cpp compiled to WASM, or transformers.js with a tiny/base English model) for on-device speech recognition — no audio leaves the machine
- Web Speech API as an optional lighter-weight fallback recognizer (flag to the user that this streams audio to the browser vendor's servers)
- Window Management API (`getScreenDetails()`) + `BroadcastChannel` for multi-window sync
- Deploy as static build (Cloudflare Pages / Netlify)

---

## Core data model

The script is a single ProseMirror/TipTap document (JSON), not plain text. This is the backbone every other feature hangs off.

Custom schema nodes/marks needed:
- `paragraph` — standard reading text
- `question` node — a block type, not a mark. Attributes: `color`, `visibleOnDisplay` (bool or per-display list)
- `note` node — director-only instruction block (e.g. "pause here", "look at camera 2"), never rendered on talent display
- `highlight` mark — attributes: `style` (persistent color/weight/spacing), `pronunciation` (optional phonetic string rendered above the word)
- Every word/token needs a stable, addressable ID — required for scroll-position anchoring and for the voice aligner to reference positions in the script

Store the document as JSON in Dexie, keyed by project. Export/import as `.json` (native project format) and export-only to `.docx`/`.md` for sharing back to non-technical collaborators.

---

## Feature 1: Import and editing

- Import `.docx` via mammoth.js (preserves bold/italic/headings as HTML, convert to TipTap doc)
- Import `.pdf` via pdf.js — extract text content, apply heuristics on Y-position to rebuild paragraph structure, expect user cleanup afterward
- Import `.txt`/`.md` directly
- Support paste from Google Docs (clipboard HTML is clean)
- Edit mode: full TipTap editor UI with formatting toolbar, question/note block insertion, highlight tool
- Prompt mode: same document, rendered with prompter styling (large text, eyeline, etc.) — never a re-import, just a different view of the same doc
- **Live editing during an active session**: operator can edit while paused (or rolling) and the display updates instantly. Scroll position must be anchored to a word/node ID, not a pixel offset, so edits above the current position don't yank the talent's place
- Export edited script back to `.docx` or `.md`

---

## Feature 2: Scroll engine

- Render text via `transform: translate3d(0, -Ypx, 0)` on the container, not `scrollTop` — smoother at slow speeds, GPU-accelerated. Add `will-change: transform`
- Drive movement from `requestAnimationFrame` timestamps, not `setInterval` — frame-rate independent
- Speed control expressed in **words per minute**, computed from actual word count in view, not an arbitrary numeric scale. Show live estimated runtime / countdown
- Ease in/out on play/pause rather than a hard snap
- Manual scroll-wheel/drag scrub that repositions without altering the speed setting (for recovering from a skipped line)
- Auto-hold at the end of each `question` block — script stops and waits for operator to advance, since answer length is unpredictable in interviews

---

## Feature 3: Multi-monitor display

This is the biggest gap versus the current tool — architect it properly from the start.

- Operator window is the single source of truth (editor + transport controls)
- Use `window.getScreenDetails()` (Window Management API, requires a one-time permission grant) to enumerate connected screens and their bounds
- Spawn one display window per screen via `window.open(url, name, 'left=X,top=Y,width=W,height=H')`, then `requestFullscreen()` on each
- **Do not sync via `localStorage` events** (this is what makes the current tool feel laggy/buggy). Use `BroadcastChannel` instead
- **Do not broadcast scroll position every frame.** Broadcast transport *state* only: `{ playing, pxPerSec, startedAt, offsetAtStart }`. Each display window independently computes its own current position every animation frame from `(performance.now() - startedAt) * pxPerSec + offsetAtStart`. This keeps all displays glued together even under frame drops. Send a periodic correction keyframe (~every 500ms) to prevent drift
- Per-display configuration (stored per display, not globally): mirror horizontally (for beam-splitter glass rigs), flip vertically, rotate 180°, font size, eyeline height, whether questions/notes are visible on that display
- Blackout key: instantly blank any display between takes
- Design the state shape transport-agnostic now so a phone/tablet display (via a relay server or WebRTC) can be added later without a rework

---

## Feature 4: Reading aids and display styling

- Adjustable eyeline indicator per display: line, side arrows, or a focus gradient dimming text away from the eyeline (try the gradient — reduces the "eyes darting" look better than a hard line)
- Optional current-line highlight band, top/bottom fade, adjustable side margins
- Font: prioritize legibility (e.g. Atkinson Hyperlegible), generous line-height, max line-length control, left-aligned (not justified)
- Question blocks: distinct color, adjustable per project, optional "Q:" prefix, independently toggleable visibility per display
- Persistent word highlighting: color swatches, plus bold/larger-size/letter-spacing options (size and spacing help legibility more than color alone)
- Pronunciation hint: optional phonetic text rendered small above a highlighted word (e.g. for names/technical terms)
- Live highlight: operator clicks a word mid-take and it lights up on the talent display immediately, independent of saved highlights

---

## Feature 5: Voice-following auto-scroll

- Recognizer runs entirely on-device (Whisper-WASM default) or optionally Web Speech API (flag the privacy tradeoff to the user — Web Speech streams audio off-device)
- Emits a stream of `{ word, timestamp, confidence }`
- **Aligner** (shared component, see Feature 6) fuzzy-matches incoming words against a sliding window of nearby expected script tokens — not the whole document — using edit-distance or phonetic matching to tolerate ASR noise
- Handle three real behaviours explicitly:
  - Skip ahead — match found further ahead in the window → jump position
  - Ad-lib / off-script — no matches for a stretch → freeze position, don't guess
  - Backtrack/retake — match found behind current position → follow back or hold (make this a toggle)
- Manual override (keyboard/scroll) always takes priority over voice-driven position — voice assists, never fights the operator
- Confidence-gate movement: below threshold, don't move that frame
- Per-session calibration step: brief sample of the actual speaker reading a line before the take, to normalize for accent/mic gain
- Input device selectable via `navigator.mediaDevices.enumerateDevices()` — defaults to laptop's built-in mic (confirmed sufficient for this use case; production audio runs on a fully separate Rode → camera path with zero interaction)
- Voice tracking is opt-in per session

---

## Feature 6: Director notes (stumble/retake flagging)

Shares the aligner from Feature 5 — do not build a second recognition pipeline.

- Because the aligner already computes expected-vs-heard, classify the gap into flags:
  - **Stumble** — repeated word or backtrack-and-retry within a few seconds
  - **Skipped line** — aligner jumped forward without intermediate words ever matching
  - **Low-confidence word** — recognizer heard something with low confidence at that position (best available proxy for a mispronunciation without full pronunciation scoring)
  - **Long pause** — gap between word timestamps exceeds a threshold
- Each flag: timestamp, script line/node reference, short auto-generated label
- **Must render only on the operator/director view. Never broadcast on the channel the talent display subscribes to.** Keep this as a hard architectural separation, not a UI toggle — the talent-facing BroadcastChannel and the director-notes channel should be distinct from the start
- Manual flag button for the director to drop a flag for anything the automatic system wouldn't catch, timestamped the same way
- Notes persist per take, not overwritten — allows comparing take 2 against take 1 when selecting footage later
- Clicking a flag jumps the script position there for an easy retake

---

## PWA / offline requirements

- Precache app shell in the service worker; bundle fonts locally (no CDN dependency) — must work fully offline on set
- Wake Lock API to prevent display sleep mid-take
- Fullscreen API + `screen.orientation.lock` for tablet displays
- Dexie for structured project storage; File System Access API so a project can live as a `.json` alongside other files for a shoot

---

## Build phases

**Phase 1 — MVP**
- Import: .docx, .txt
- TipTap editor with basic schema (paragraph, question, highlight — no pronunciation/notes yet)
- Scroll engine: transform-based, rAF-driven, WPM control, estimated runtime
- Single display: mirroring toggle, eyeline indicator
- Keyboard transport controls (play/pause, speed, jump)
- Offline-capable PWA shell

**Phase 2**
- Multi-window via Window Management API + BroadcastChannel, per-display config
- Question block auto-hold, per-display visibility toggles
- Persistent highlights with pronunciation hints
- Live click-to-highlight during a take
- Blackout control

**Phase 3**
- PDF import with cleanup workflow
- Voice-following auto-scroll (Whisper-WASM aligner, calibration step, skip/ad-lib/backtrack handling)
- Director notes log, separate BroadcastChannel, manual flag button, per-take history
- Project library, docx/md export
- Device picker for audio input

**Later / exploratory**
- Phone/tablet as a networked display or remote control
- Pronunciation/accuracy scoring beyond confidence-based heuristics

---

## Known hard parts worth extra care

1. Multi-window sync must broadcast state, never per-frame position — this is the single biggest source of the jank in the current tool
2. The voice aligner needs a bounded search window and confidence gating, or one misheard word will cause a visible mis-jump
3. Talent display and director-notes channel must be architecturally separate, not just hidden by a UI flag — this is a "never leaks" requirement, not a preference
4. PDF import will always need a manual cleanup pass — design the editor UX assuming that, don't chase perfect auto-structuring
