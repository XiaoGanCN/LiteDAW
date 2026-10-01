# LiteDAW — UI CONTRACT (read before writing page code)

This document is the **only** shared agreement between the page modules. Read the
files it references before writing code; do not invent APIs that are not there.

## 0. Ground rules

- **Do not modify any file outside your own page folder** (`src/pages/<yours>/`).
  If a shared primitive is missing something, implement the variant locally in
  your folder instead. Shared files are owned by the integrator.
- Your page folder owns its CSS: create `src/pages/<yours>/<name>.css` and
  `import './<name>.css'` from your page component. Never edit
  `src/styles/*.css`.
- TypeScript is strict, `noUnusedLocals` and `noUnusedParameters` are on.
  `npx tsc --noEmit` must pass.
- Export exactly one page component: `export function PitchPage()` /
  `export function BpmPage()`. The shell already imports it by that name.
- React 19, function components, hooks only. No new dependencies.
- Everything must work with mouse **and** touch (pointer events).

## 1. Files you must read first

| File | What it gives you |
| --- | --- |
| `src/styles/tokens.css` | Every colour, spacing, motion and type token. Use `var(--…)`, never raw hex, except for data-driven colours. |
| `src/styles/controls.css` | `.panel`, `.well`, `.btn`, `.seg`, `.rocker`, `.led`, `.legend`, `.readout`, `.chip`, `.meter`, `.tabs`, `.field`, `.input`, `.numdrag`, `.divider`, `.row`, `.col` |
| `src/styles/instruments.css` | `.knob`, `.fader`, `.bar`, `.wheel`, `.dial`, `.piano`, `.toast`, `.toggle-row` |
| `src/styles/layout.css` | `.pagegrid`, `.pagegrid__main`, `.pagegrid__side`, `.ticker` |
| `src/components/ui/kit.tsx` | `Panel`, `Well`, `Btn`, `IconBtn`, `BtnGroup`, `Segmented`, `Rocker`, `ToggleRow`, `Led`, `Legend`, `Readout`, `Chip`, `NumDrag`, `Tabs`, `Divider`, `Field`, `Empty`, `Modal`, `useToast` |
| `src/components/ui/Hardware.tsx` | `Knob`, `Fader`, `Meter`, `Bar` |
| `src/components/ui/WheelPicker.tsx` | `WheelPicker`, `WheelItem` |
| `src/components/ui/DialPicker.tsx` | `DialPicker`, `DialItem` |
| `src/components/ui/PianoKeyboard.tsx` | `PianoKeyboard`, `KeyState`, `midiToName`, `midiToPc`, `pcName`, `NOTE_NAMES` |
| `src/design/Icon.tsx` | `Icon`, `IconName` (the full glyph list — use only these names) |
| `src/audio/engine.ts` | `engine`, `formatTime`, `formatBarsBeats` |
| `src/audio/synth.ts` | `playNote`, `NotePlayer`, `INSTRUMENTS`, `InstrumentId` |
| `src/audio/dsp.ts` | `midiToFreq`, `midiName`, `pitchClassName`, `CHORD_LABELS`, `SCALES`, `CHORD_INTERVALS` |
| `src/audio/sampler.ts` | `samples` (library), `detectPitch` |
| `src/audio/scopes.ts` | `paintSpectrum`, `paintWaveform`, `paintVectorscope`, `SCOPE_THEMES`, `paintScopeFrame` |
| `src/state/settings.ts` | `useSettings`, `currentFxLevel()` |
| `src/state/pitch.ts` | the whole Pitch trainer store + `gradeAnswer`, `qualitiesFor`, `weakPairs` |
| `src/state/bpm.ts` | the whole BPM trainer store + `tempoMark` |
| `src/audio/metronome.ts` | `metronome`, `Metronome`, `ClickSound`, `DEFAULT_METRONOME` |

## 2. Visual language (non-negotiable)

Avionics / motorsport flat. Carbon-fibre ground, machined aluminium trim, hot
saturated red (`var(--red)`) **only** on the primary interactive element of a
view at any moment. Glow is reserved for things that need attention — a live
indicator, the thing you must press, a wrong answer. Never glow decoration.

- Panel headers use `<Panel title icon tag actions>`; body content goes inside.
- Numbers are readouts: `<Readout value unit tone size />` (mono, tabular).
- Labels are `class="t-label"` (condensed, uppercase, tracked).
- Micro captions are `class="t-micro"`.
- **Morphing shapes**: buttons already morph their outline on press. Add
  `transition` on `border-radius`, `transform`, `clip-path` for state changes.
  Segmented indicators, dial heads and wheel gates already animate — reuse them.
- **Stylised transitions**: when a panel's content changes phase, animate with
  `--ease-snap` / `--ease-out` and short durations; use `@keyframes` in your own
  CSS file. Stagger list items with `animation-delay`.
- Icons: interactive-heavy elements always carry one.
- Respect `:root[data-motion='reduced']` — you do not need to do anything
  special if you use the `--t-*` duration tokens, which collapse automatically.

## 3. Required page anatomy

Both pages use this skeleton:

```tsx
<div className="pagegrid">
  <div className="pagegrid__main">
    {/* the instrument: the big working surface */}
  </div>
  <div className="pagegrid__side">
    {/* configuration + performance readouts + diagnostics */}
  </div>
</div>
```

The `.pagegrid` already switches to a single scrolling column on phones.

Every page must render a footer `.ticker` strip inside `.pagegrid__main`'s last
panel or as the last child of the page, showing live module telemetry.

## 4. Audio rules

- Never construct an `AudioContext`. Use `await engine.init()` or the
  `NotePlayer` / `metronome` helpers, which initialise lazily.
- Route sound to `engine.bus('pitch')` or `engine.bus('bpm')` respectively.
- Every audible action must originate from a user gesture at least once; the
  shell already installs a global unlock handler, but call `engine.init()` in
  click handlers anyway (it is idempotent and cheap).
- Use `requestAnimationFrame` for visualisers and always cancel on unmount.

## 5. Deliverable checklist

- [ ] Page renders with no console errors and no TypeScript errors.
- [ ] Keyboard accessible: Enter/Space activate, arrow keys adjust.
- [ ] Works at 360 px width without horizontal scrolling.
- [ ] All three card states exist: idle, running, revealed/result.
- [ ] No `any` casts of store objects; no `@ts-ignore`.
