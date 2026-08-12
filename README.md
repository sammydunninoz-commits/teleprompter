# autocue Teleprompter (PWA)

A progressive web app for video-production auto-cue teleprompting. Replaces
"Imaginary Teleprompter" with proper multi-monitor architecture, in-app editing
after import, question/note distinction, word highlighting, and (Phase 3) voice-
following auto-scroll with director stumble notes.

Built to the spec in [`teleprompter-pwa-build-spec.md`](teleprompter-pwa-build-spec.md).

## Status — Phases 1, 2 & 3 complete

| Feature | State |
| --- | --- |
| Import `.docx` (mammoth), `.txt`, `.md` | ✅ |
| TipTap editor with custom schema (paragraph, **question**, **note**, highlight mark, stable word IDs) | ✅ |
| Selection-scoped Q / Note (split out only the highlighted text) + per-question colour picker | ✅ |
| Transform + `requestAnimationFrame` scroll engine, **words-per-minute** speed (40–700), live runtime estimate | ✅ |
| Eyeline: **focus box** (Imaginary-style) / focus gradient / line / arrows, adjustable dim + box height | ✅ |
| Whole-script end-stop (last line settles on the eyeline) | ✅ |
| Keyboard transport (space, arrows, Home, B) | ✅ |
| **Multi-window**: one prompter window per screen via Window Management API, `BroadcastChannel` sync | ✅ |
| Per-display config (mirror / flip / rotate / font / eyeline / question & note visibility), broadcast live | ✅ |
| Question auto-hold, live click-to-highlight, per-display + blackout-all | ✅ |
| Persistent highlights + **pronunciation hints** (phonetic text above the word) | ✅ |
| Offline-capable PWA shell + Wake Lock | ✅ |
| Project storage (Dexie) + `.json` export/import | ✅ |

**Phase 3:**

| Feature | State |
| --- | --- |
| **PDF import** (pdf.js) with Y-position paragraph heuristics + editor cleanup | ✅ |
| **Phone remote**: scan a QR to drive speed / play / position from a handheld over WebRTC | ✅ |
| **Voice speed-match**: scroll WPM tracks the speaker's pace through the script (smooth, not position-jump) | 🚧 built, switched off |
| Pace measured from aligner progress (bounded-window fuzzy + phonetic match, confidence gate); decays to a stop on silence; manual override always wins | ✅ |
| Recognizer: Web Speech (working, privacy-flagged) + on-device Whisper (optional, lazy) | ✅ |
| Per-session calibration + audio input device picker | ✅ |
| **Director notes**: classifier on the shared aligner, separate `BroadcastChannel`, per-take history, click-to-jump, manual flag | ✅ |
| Project library (Dexie) | ✅ |
| Export the live script (incl. unsaved edits) as `.json` from the Projects sidebar | ✅ |
| Markdown / Word export — `exportMarkdown` / `exportDoc` exist in `io/export.ts` but no UI calls them yet | 🚧 |

The aligner (`src/voice/aligner.ts`) is a pure module and is unit-verified for
all six behaviours (normal / skip / ad-lib / backtrack / stumble / confidence-
gate). Director flags are proven to travel only on the director channel — never
the talent channel.

### Phone remote usage

In **Prompt** mode → the **Remote** tab → **Start remote session**. Scan the QR
with a phone (or open the link / type the pairing code) and the phone becomes a
handheld transport: **speed (WPM)** slider, play/pause, back-to-top, position
scrubber and a live runtime countdown.

The phone is a *controller*, not a display — it receives transport state only,
never the script body and never director flags. Commands go through the ordinary
store actions, so a phone press reaches the talent screens by exactly the same
path as a click on the desktop transport bar.

Pairing uses the public PeerJS broker for signalling, after which commands travel
directly device-to-device. Both ends therefore need internet to *pair*, which is
the one place this feature departs from the app's otherwise fully-offline
promise. The pairing code dies with the session, so an old QR photo is useless.

> Requires a secure context (HTTPS, or `localhost`). Testing over plain HTTP on a
> LAN IP will fail on iOS.

### Voice tracking & director notes usage

> **Currently switched off** via `FEATURES.voice` in `src/lib/features.ts`. The
> whole subsystem below is still present and still compiles — it is simply not
> mounted, so the app never asks for microphone permission. Flip the flag to
> `true` to bring the **Voice** tab back. The **Notes** tab is unaffected: its
> flags are operator-pressed, not speech-derived.

In **Prompt** mode → the **Voice** tab: pick a recogniser (Web Speech works out
of the box but streams audio off-device; Whisper is fully on-device once
`@huggingface/transformers` is installed), pick a mic, optionally **Calibrate**
(read a line so the confidence gate adapts to the speaker), then **Start
tracking**. The prompter now rolls continuously and its **speed (WPM) matches the
speaker's pace** through the script — speak faster and it speeds up, pause and it
slows to a stop. It does not jump position to matched words. Grabbing the wheel,
speed slider or keyboard always overrides it. In the background the **Notes** tab
logs stumbles / skipped lines / long pauses / low-confidence words automatically,
plus a manual **Flag now** button; click any flag to jump the script there for a
retake. Flags persist per take.

> On-device Whisper: `npm i @huggingface/transformers` to enable it. The app runs
> without it and falls back to Web Speech.

### Multi-window usage

In **Prompt** mode, the right-hand **Displays** panel drives talent screens:

1. **Detect screens** → grant the one-time Window Management permission → each
   connected screen is listed.
2. **Open here** on a screen (or **Open display window** for a plain popup you drag
   over yourself) spawns a follower prompter at `?display=<id>`; click **Fullscreen**
   in it.
3. Each display has its own config (mirror for beam-splitter glass, font, eyeline,
   whether questions/notes show). Edits and transport broadcast live over
   `BroadcastChannel`; every window derives its own scroll position from transport
   state, so they stay glued together. **Blackout all** (or `B`) blanks them between takes.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build + service worker into dist/
npm run preview  # serve the production build
```

> Node.js 18+ required. This machine had Node installed via `winget install OpenJS.NodeJS.LTS`.

## How it's laid out

```
src/
  store/
    types.ts        Project, TransportState (transport-agnostic), DisplayConfig, DirectorFlag
    useStore.ts     Zustand store — the operator is the single source of truth
    db.ts           Dexie (projects + per-take flags)
  channel/
    channels.ts     TWO separate BroadcastChannels: talent vs director (never merged)
  remote/
    protocol.ts     Phone-remote wire types + pairing-code generation
    usePeerHost.ts  Operator side: PeerJS host, applies commands via store actions
    RemoteView.tsx  The handheld surface itself (?remote=<code>)
  lib/
    features.ts     Build-time switches (voice off, remote on)
  scroll/
    transport.ts    Pure position math: offsetAt(state, now), WPM→px/s, runtime estimate
  editor/
    extensions.ts   Schema bundle (StarterKit + custom)
    blockId.ts      Assigns stable blockId to every block → word address = `blockId#index`
    nodes.ts        Question + Note block nodes
    highlightMark.ts  Persistent highlight (colour/bold/size/spacing/pronunciation)
    renderDoc.ts    Doc → HTML with per-word spans; hard-filters notes off talent output
    EditorPane.tsx / EditorToolbar.tsx
  display/
    DisplayView.tsx One prompter surface. Derives its own offset every frame from
                    transport state. Reused as operator preview now, spawned window later.
  components/       TransportBar, DisplaySettings
  hooks/            useKeyboardTransport, useWakeLock
  io/               import (docx/txt/md), projectFile (.json)
  App.tsx
```

### Design decisions that pay off in Phases 2–3

- **Transport state, never per-frame position.** `TransportState` is
  `{ playing, pxPerSec, startedAt, offsetAtStart, seq }`. Every display derives
  its own pixel offset each animation frame via `offsetAt()`, using a cross-window
  epoch clock (`performance.timeOrigin + performance.now()`). Adding a second
  window or a phone display is a subscribe, not a rewrite — and displays stay
  glued together under frame drops. This is the fix for the current tool's jank.
- **Talent vs director channels are separate `BroadcastChannel`s from day one**
  (`channels.ts`). Director flags physically cannot travel on the talent channel —
  a "never leaks" guarantee, not a UI toggle.
- **Stable word IDs** (`blockId#index`). Scroll position anchors to a word, not a
  pixel offset, so editing above the current line doesn't yank the talent's place
  (`DisplayView` re-anchors the eyeline word across edits). Same IDs are what the
  Phase-3 voice aligner will reference.
- **Notes hard-filtered in the renderer** (`renderDoc.ts`), independent of any
  per-display flag.

## Notes / follow-ups

- **Fonts:** the prompter font stack is Atkinson Hyperlegible with a system-ui
  fallback. Drop `atkinson-regular.woff2` / `atkinson-bold.woff2` into
  `public/fonts/` to bundle it for full offline legibility (referenced in
  `src/index.css`).
- **Automated testing caveat:** `requestAnimationFrame` is paused when the browser
  tab isn't being composited (e.g. a hidden automation pane), so the scroll won't
  visibly move there. It runs normally in a real, visible browser window. The
  underlying transport math is unit-testable via `scroll/transport.ts`.
- **PWA icons** use the SVG favicon (valid for manifests). Add PNG 192/512 icons
  for the widest install-surface support.
