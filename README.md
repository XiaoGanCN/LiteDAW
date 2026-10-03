# LiteDAW

**An avionics-styled ear trainer and multitrack mini-studio that runs in any modern
browser on PC/Mac and installs on Android — and can be packaged as a standalone
Android app.**

Three modules, each on its own page:

| Module | Purpose |
| --- | --- |
| **Pitch** | Identify notes and chords by ear. Piano-keyboard or Android-alarm-clock dial input. Adaptive weakness model. |
| **Tempo** | Identify a metronome's BPM, or tap it in. Wheel-drum answer entry, timer, animated beat visualiser. |
| **Studio** | Multitrack timeline recorder/mixer with import + export across WAV / MP3 / M4A / OGG / FLAC. |

---

## 1. Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Build | **Vite 8** (`base: './'`) | Relative asset URLs are what let the *same* `dist/` run from a web server, from `file://`, and from Capacitor's `https://localhost` shell. |
| UI | **React 19 + TypeScript 5.9 (strict)** | Function components only; no component library — the whole design system is hand-built CSS + SVG. |
| State | **Zustand 5** (+ `persist`) | Small, selector-friendly stores. Training profiles and the project survive reloads. |
| Audio | **Web Audio API** (native) | Synthesis, scheduling, metering, offline rendering. No audio framework. |
| Codecs | **Mediabunny 1.58** + `@mediabunny/mp3-encoder`, `-flac-encoder`, `-aac-encoder` | Decodes and encodes every container the brief asks for, using native WebCodecs where the platform has it and bundled WASM (LAME / libFLAC / AAC) where it does not. |
| Recording | **AudioWorklet** PCM capture (ScriptProcessor fallback) | Raw float32 at the context's native rate — no codec round-trip. |
| Packaging | **PWA** (installable) + **Capacitor 8** (standalone Android) | |
| Fonts | Chakra Petch · Barlow · Barlow Condensed · Share Tech Mono, self-hosted | Works fully offline. Vendored by `scripts/fetch-fonts.mjs`. |

Nothing is loaded from a CDN at runtime.

---

## 2. Running it

```bash
npm install

npm run dev        # http://localhost:5273
npm run build      # → dist/
npm run preview    # serve the production build
npm run typecheck  # tsc --noEmit
```

Regenerating vendored assets (only needed if you change them):

```bash
node scripts/fetch-fonts.mjs   # re-download the type stack into public/fonts
node scripts/gen-icons.mjs     # re-render the PNG launcher icon set
```

### Browser support

| Browser | Status |
| --- | --- |
| Chrome / Edge 111+ (desktop & Android) | Full — every export codec available via WebCodecs + WASM |
| Safari 16.4+ (macOS / iOS) | Full except Ogg/Vorbis encode (falls back to Opus or the WASM encoder when present) |
| Firefox 115+ | Full except AAC encode (WebCodecs AAC is Chromium-only; the export bay disables codecs it cannot encode) |

The export dialog probes the device at open time with `canEncodeAudio()` and only
offers codecs it can actually write.

---

## 3. Android

There are two routes. **Do the PWA route first** — it needs no toolchain.

### 3a. Install as a PWA (no build tools)

Serve `dist/` over HTTPS (or `localhost`), open it in Chrome for Android, then
**⋮ → Add to Home screen**. It launches standalone, works offline (Workbox
precache), and requests microphone access for recording.

### 3b. Host it on GitHub Pages

**Yes — this works out of the box, including at a repository sub-path.**
There is no base-path configuration to add and no server to configure:

- `vite.config.ts` sets `base: './'`, so every emitted script, stylesheet,
  font, icon and the PWA manifest are referenced **relatively**. The same
  `dist/` therefore loads correctly from `https://user.github.io/repo/`, from a
  domain root, and from Capacitor's `https://localhost` shell.
- Routing is **hash-based** (`#/pitch`, `#/bpm`, `#/daw`), so GitHub Pages
  never has to rewrite an unknown path back to `index.html`. A deep link in a
  bookmark or a hard refresh on `#/daw` just works.
- The type stack is self-hosted under `public/fonts/`, so there is no
  cross-origin request to Google Fonts to break or slow down.
- The service worker registers with `./sw.js` and `scope: './'`, which resolves
  correctly inside a sub-path.

A workflow is already committed at
[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).
It typechecks, builds, adds `dist/.nojekyll` (so the `_`-prefixed Rollup chunks
are served), and publishes the artifact.

One-time setup in the repository:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
   (Already enabled through the API for `XiaoGanCN/LiteDAW`.)
2. Push to `main`. The workflow runs and publishes to
   **https://xiaogancn.github.io/LiteDAW/**.

To run it yourself instead of via Actions:

```bash
npm run build
npx vite preview --base ./ --port 5273   # sanity check the exact bundle
# then publish dist/ to any static host: Pages, Netlify, S3, nginx, …
```

If you would rather deploy to a *project* path with an absolute base (for
example to keep `import.meta.env.BASE_URL` meaningful), pass it explicitly:

```bash
npx vite build --base /LiteDAW/
```

Note that a service worker plus a CDN can serve a stale build after a deploy.
The app uses `registerType: 'autoUpdate'`, so a new worker installs on the next
visit and the following load picks it up.

### 3c. Standalone APK / AAB with Capacitor

Prerequisites: **JDK 17+**, **Android Studio** (or the command-line SDK with
`ANDROID_HOME` set), and `adb` for device installs.

```bash
npm install                 # brings in @capacitor/core, /cli, /android
npm run build               # produce dist/
npx cap add android         # one time: creates ./android
npx cap sync android        # copy dist/ + plugins into the native project

npx cap open android        # opens Android Studio → Run ▶
# or, fully headless:
npm run cap:build           # gradle assembleDebug → android/app/build/outputs/apk/debug/
```

Install the debug build:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Release build:

```bash
cd android && ./gradlew bundleRelease   # → app/build/outputs/bundle/release/app-release.aab
```

`capacitor.config.ts` already sets the app id (`dev.litedaw.app`), the app name,
`webDir: 'dist'`, the dark background colour and `androidScheme: 'https'`.

### Android notes

- **Microphone** — the recorder path uses `getUserMedia`. Capacitor's Android
  shell grants `RECORD_AUDIO` through the WebView permission bridge; the app
  requests it on the first record press. If you build a custom native shell, add
  `<uses-permission android:name="android.permission.RECORD_AUDIO"/>` and
  `<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS"/>`.
- **Audio focus & low latency** — Web Audio runs on the native `AudioTrack`
  backend. Set `android:hardwareAccelerated="true"` (default) and keep the
  WebView on the Chromium updatable provider for the lowest latency.
- **Storage** — imports are held in memory; user samples for the pitch trainer
  are persisted as original blobs in IndexedDB. Project JSON and training
  profiles persist in `localStorage`. Nothing leaves the device.
- **Rotation / notches** — the layout is fully responsive, uses
  `env(safe-area-inset-*)`, and moves the navigation rail to a bottom bar in
  portrait.

---

## 4. The design language

An avionics/flight-deck panel crossed with a motorsport livery: **flat, precise,
semi-realistic.** All tokens live in `src/styles/tokens.css`.

- **Ground** — twill carbon fibre (`--carbon-*`) with procedural weave textures
  (`.tex-carbon`, `.tex-carbon-fine`).
- **Trim** — machined and brushed aluminium (`--alu-*`, `.tex-alu`,
  `.tex-bezel`), used for panel frames, transport bars and engravings.
- **Signal** — saturated `#C70F28` is reserved for *the one thing you must press
  right now*. Amber = caution, green = go/valid, cyan = data, magenta/violet =
  auxiliary. Glow (`--glow-*`, `--text-glow-*`) appears **only** on live
  indicators and required actions.
- **Type** — a four-voice stack, used as a hierarchy rather than decoration:
  Chakra Petch for display and big numerals, Barlow for prose, Barlow Condensed
  for tracked uppercase silk-screen labels, Share Tech Mono for tabular readouts.
- **Vector everywhere** — every icon is a single-stroke 24×24 glyph
  (`src/design/Icon.tsx`); the dial, knob, pendulum, meters, scopes, timeline and
  keyboard are all drawn as SVG or canvas vector geometry.
- **Motion** — shapes genuinely morph: buttons round into pills on press, the
  segmented-control indicator slides and re-rounds, the modal re-radiuses as it
  grows in, nav bars grow out of a 6 px seed. Durations come from `--t-*`, so
  `prefers-reduced-motion` (and the in-app Motion setting) collapse them.
- **Frutiger-Aero** — used sparingly: a cyan/blue glass sheen on floating chrome,
  the `.tex-aero` overlay, soft gloss highlights on key caps and fader handles.

### The artifact / defect filter

A global, uniformly switchable semi-realism layer — toggle it from the top bar
or in **Settings → Artifact / Defect Layer**, or per-channel:

| Channel | Implementation |
| --- | --- |
| Scanlines | `repeating-linear-gradient` overlay, `mix-blend-mode: overlay` |
| Refresh roll | slow animated bright bar |
| Sensor grain | animated SVG `feTurbulence` tile, jittered by transform steps |
| Lateral chroma bleed | red/cyan edge gradients in `screen` blend |
| Lens vignette | radial falloff |
| Phosphor bloom | additive accent glows |
| True displacement defect | the `#litedaw-defect` SVG filter (feTurbulence → feDisplacementMap → RGB split → bloom), opt-in via `.fx-defect` on any surface |

Everything is driven by `--fx-*` multipliers on `:root`, so switching to
**Pristine** produces a pixel-identical flat design — the CSS overlay is fully
neutralised and canvases read `currentFxLevel()`, which returns `0`.

---

## 5. Module documentation

### 5.1 Pitch trainer — `src/pages/pitch/`, `src/state/pitch.ts`

- **Material** — single notes or chords. Chords are constrained by flavour
  (major / minor / both / custom), explicit quality list, and voice count 2–5.
  Inversions are optional.
- **Range** — octave window plus an optional scale mask (14 scales) with a
  tonic selector.
- **Timbre** — 15 built-in synthesis models (`src/audio/synth.ts`: additive
  piano, FM electric piano and bell, marimba, pluck, drawbar organ, string
  ensemble, pad, saturated bass, sub, and the four plain waves) mixed with any
  number of **user-uploaded samples**. Dropping a file runs an autocorrelation
  pitch detector that proposes the root note; you can override it.
- **Playback** — block or arpeggio, adjustable sustain, N automatic replays, an
  A/B button that re-plays the previous question, and ± cent detune jitter so
  absolute-pitch users cannot shortcut.
- **Answering** — either the **piano keyboard** (single pick for notes,
  multi-select for chords, glissando auditioning) or the **radial dial** with
  Android-alarm-clock interaction: drag the head around the ring, hear each
  detent as you pass it, release to commit. Chords use the dial's multi mode.
- **Reveal** — target note + frequency in Hz, or chord symbol + interval
  formula; the keyboard lights green on truth and red on misses.
- **Adaptive weakness model** — a persisted 12×12 pitch-class confusion matrix
  plus a chord-quality confusion matrix.
  - Rows are weighted by off-diagonal error rate; unseen classes get a mild
    curiosity bonus so the model keeps exploring.
  - `weakPairs()` ranks confusable pairs by `count × error`.
  - A **DRILL** button pins a focus pair: 75 % of subsequent questions target it,
    and the generator deliberately varies octave and instrument so you learn the
    *interval*, not one timbre.
  - `adaptivity` interpolates between uniform and fully weakness-driven.
  - Diagnostics: the heat-grid itself, the ranked weak pairs, per-pitch-class
    accuracy, accuracy by instrument / octave / chord quality, latency, streaks
    and a tick sparkline. Profiles export and import as JSON.

### 5.2 BPM trainer — `src/pages/bpm/`, `src/state/bpm.ts`

- **Modes** — *identify* (listen, then dial in the tempo) and *tap* (tap along;
  the BPM is taken from the median inter-tap interval).
- **Reference** — a lookahead-scheduled metronome (`src/audio/metronome.ts`) on
  the Web Audio clock, with five click timbres, configurable time signature,
  subdivisions, accent pattern, downbeat-only mode, and a bar count before the
  reference stops (`0` = endless).
- **Answer entry** — the inertial **wheel drum** (`WheelPicker`) with a machined
  selection gate, 5 visible rows and 3-D rotation per row.
- **Visualiser** — a pendulum whose angle is the fractional beat phase, a beat
  ring of lamps with fast-attack/exponential-decay flashes, subdivision ticks, a
  bar-progress arc and a scrolling 4-bar beat history. All of it is driven by
  `metronome.drain(ctx.currentTime)` inside `requestAnimationFrame`, so it is
  sample-accurate rather than approximate.
- **Adaptivity** — the range is split into 12 regions; each round's absolute
  percentage error feeds its region, and `nextTarget()` picks tempos from a
  weighted grid that favours the regions you misjudge.

### 5.3 Studio — `src/pages/daw/`, `src/state/daw.ts`, `src/audio/dawEngine.ts`

**Timeline** (single canvas, with a cached offscreen plate)

- Add / delete / rename / reorder tracks; per-track colour, height, level, pan,
  mute, solo, record-arm, input monitor, and a 4-band parametric EQ.
- Drag-and-drop audio files onto any lane → decode → clip at the drop position.
- Clips: move (with cross-track dragging), trim from either edge, fade handles in
  the top corners, mute, rename, gain, pitch, speed, duplicate, split at the
  playhead, delete.
- Multi-select by shift/⌘-click or marquee; group moves and group trims.
- Snapping: off / grid / clip edges / both — clip snapping also snaps to the
  playhead. Snap threshold is computed in pixels, so it behaves the same at
  every zoom level.
- Scrubbing on the ruler plays short grains from whatever is under the playhead.
- Auto-scroll follows the playhead, with a lead margin.
- Zoom from 0.4 px/s to **40 000 px/s** (⌘/ctrl-wheel zooms to the cursor). Past
  ~900 px/s the waveform switches from a min/max envelope to **individual
  samples**, and past 1 sample/pixel it draws sample dots and labels the view
  `SAMPLE VIEW`.
- Overview strip above the ruler shows the whole project, the viewport window
  and the playhead; double-click the ruler to set a 2-bar loop.
- Right-click context menu for import / split / duplicate / delete / loop / set
  playhead / add track.

**Mixer & engine**

- Each track is a real channel strip: `input → 4× biquad EQ → stereo panner →
  gain → master → limiter → destination`.
- A **lookahead scheduler** (30 ms tick, 350 ms horizon) creates clip sources
  just before they sound, so live edits take effect immediately and memory stays
  flat on long projects. Loop wrapping realigns the project↔context time mapping
  so loops are seamless.
- Per-track meters and a master meter are read from analyser taps; faders and
  pans are applied with `setTargetAtTime` ramps, not jumps.
- Recording captures the selected input as raw float32 PCM through an
  AudioWorklet and drops the take as a clip on the armed track.

**Inspector** — clip tab (gain, pitch, speed, fades, trim, normalise, print
fades, audition, save clip as WAV), track tab, EQ tab (draggable response-curve
nodes computed from the real RBJ biquad transfer functions), session tab.

**Scopes** — spectrum (log-frequency FFT with peak-hold and a frequency ruler),
waveform (rising-edge triggered oscilloscope), and vector/goniometer (M/S
rotated Lissajous with a polar graticule). Individually toggleable, dockable or
floating, four colour themes, shared zoom knob.

**Import / export**

- Import: WAV, MP3, M4A/AAC, OGG/Vorbis/Opus, FLAC, AIFF, WebM/CAF. Native
  `decodeAudioData` is tried first (it preserves the file's native sample rate);
  Mediabunny demux+decode is the fallback. Clips keep their own sample rate, and
  Web Audio resamples on playback — so **mixed-rate projects just work**.
- Export: offline render through the *same* graph builder used for playback, then
  encode via Mediabunny. Container, codec, mono/stereo, sample rate
  (22.05 k–192 k), bit depth (16/24/32f) or bitrate (96–320 kbps), optional
  normalisation, optional loop-region-only render, live progress, and a clipping
  warning from a peak scan of the render.

  | Container | Codecs |
  | --- | --- |
  | WAVE | PCM 16 / 24 / 32-bit float |
  | MPEG-1 Layer III | MP3 (bundled LAME WASM) |
  | MPEG-4 Audio (`.m4a`) | AAC-LC (WebCodecs, WASM fallback) |
  | Ogg | Opus (WebCodecs) · Vorbis |
  | FLAC | FLAC (bundled WASM) |

  WASM encoders are lazily imported, so the payload is only fetched when you
  actually export that format.

---

## 6. Source map

```
src/
  main.tsx                 boot: apply theme, unlock audio, restore samples
  App.tsx                  shell, hash router, rail, top bar, settings bay
  audio/
    engine.ts              AudioContext graph, buses, limiter, meter taps, worklet
    synth.ts               15 synthesis voices + NotePlayer
    sampler.ts             user sample library, autocorrelation pitch detect, IndexedDB
    metronome.ts           lookahead click scheduler, beat events, position query
    dsp.ts                 granular pitch shift, resample, fades, peaks, note/chord maths
    decode.ts              native → mediabunny import pipeline
    encode.ts              containers, codec probing, WASM encoder registration
    recorder.ts            AudioWorklet PCM capture
    scopes.ts              spectrum / waveform / vectorscope / clip painters
    dawEngine.ts           graph builder, lookahead transport, offline render
  daw/buffers.ts           AudioBuffer registry + memoised pitch-shifted variants
  design/
    Icon.tsx               the whole vector icon set
    Fx.tsx                 SVG filter defs + the artifact/defect overlay stack
  components/ui/           Panel, Btn, Segmented, Rocker, Led, Readout, NumDrag,
                           Modal, Toast, Knob, Fader, Meter, WheelPicker,
                           DialPicker, PianoKeyboard
  state/                   settings · pitch · bpm · daw (zustand + persist)
  pages/pitch|bpm|daw/     the three modules
  styles/                  tokens · base · controls · instruments · layout · pages
docs/UI-CONTRACT.md        the shared UI agreement between modules
scripts/                   font vendoring, icon generation
```

---

## 7. Keyboard shortcuts (Studio)

| Key | Action |
| --- | --- |
| `Space` | Play / pause |
| `Home` / `End` | Go to start / project end |
| `S` | Split selection at the playhead |
| `D` | Duplicate selection |
| `L` | Toggle loop |
| `C` | Toggle metronome |
| `+` / `-` | Zoom in / out |
| `⌘/ctrl + Z` / `⇧⌘Z` | Undo / redo |
| `⌘/ctrl + A` | Select all clips |
| `⌘/ctrl + E` | Open export |
| `⌘/ctrl + I` | Import audio |
| `Delete` | Delete selection |
| `⌥`-drag | Pan the timeline |
| `⌘/ctrl`-wheel | Zoom to cursor |
| `⇧`-wheel | Scroll horizontally |

---

## 8. Verification

Three gates, all wired to npm scripts:

```bash
npm run typecheck     # tsc --noEmit, strict + noUnusedLocals/Parameters — clean
npm run build         # vite production build
npm run smoke         # headless Chrome pass over all three modules
npm run verify:fixes  # 18 behavioural checks for the ear trainers and the shell
npm run verify:daw    # 20 behavioural checks for the Studio
```

`npm run smoke` boots the real production bundle in the locally installed
Google Chrome (no browser download), walks every route, drives each module
through its actual flow, and fails on any console error, page exception or
failed request. It also re-runs the two trainers at a 390 px phone viewport and
asserts there is no horizontal document overflow. Screenshots land in
`.smoke/` for visual review. Coverage:

| Step | What it proves |
| --- | --- |
| Pitch: play → answer on the keyboard → grade → dial input → grade | Question generation, both answer surfaces, grading, reveal |
| Tempo: start → reference plays → drum the wheel → lock in → debrief | Metronome scheduling, wheel picker, timer, beat visualiser, verdict |
| Studio: add track → play → import a WAV → select the clip → all four inspector tabs → scopes → settings | Timeline canvas, decode pipeline, clip model, EQ curve, scopes, export bay |
| Mobile pass at 390×844 | Responsive shell, bottom navigation rail, no clipped instruments |

`npm run verify:daw` covers the Studio specifically, and is the suite that
proves the routing fix (the instruments read flat until the project mix was
routed through the shared master) and the timeline's edit semantics:

| Check group | What it asserts |
| --- | --- |
| Instruments | The spectrum animates while the Studio plays (27 distinct frames vs 2 when silent) and the transport OUT meter moves |
| Track header | Reorder grip, delete button, bottom-edge resize, drag-to-reorder actually changing the order, and ⌘/ctrl+Backspace deleting the focused track |
| Clip placement | A drop adds a clip, a second clip cannot overlap the first (project length grows rather than staying put), and a multi-file drop lays clips in parallel, adding tracks when it runs out of lanes |
| Snap & navigation | The playhead lands exactly on the grid, the minimap scrolls the viewport, zoom changes scale, and time labels stay sparse when fully zoomed out |
| Loop & transport | The loop range drags on the ruler and has numeric start/end fields; the playhead can be repositioned while the transport is rolling |
| Media & health | Clips relink from the IndexedDB media vault after a reload, with no console errors |

The deployed build can be checked the same way, which is what proves the
sub-path hosting story:

```bash
npm run check:deployed                                  # the GitHub Pages build
npm run check:deployed -- https://example.com/litedaw/  # any other origin
```

It loads every route from the live origin and asserts that the self-hosted
fonts resolve, the service worker registers with the correct scope, and no
request fails.

---

## 9. Privacy

Everything runs locally. Audio never leaves the device, nothing is uploaded, and
there are no analytics or network calls at runtime.
