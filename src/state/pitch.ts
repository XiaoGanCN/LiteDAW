/* ============================================================================
   LiteDAW · PITCH TRAINER STATE
   Session engine plus the adaptive weakness model. The model keeps a 12×12
   pitch-class confusion matrix and a chord-quality confusion matrix, then
   biases question generation toward the pairs the player actually confuses —
   across different octaves and different timbres.
   ========================================================================= */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  CHORD_INTERVALS,
  CHORD_LABELS,
  SCALES,
  chordName,
  midiToFreq,
  pitchClassName,
  type ChordQuality,
  type ScaleName,
} from '../audio/dsp';
import type { InstrumentId } from '../audio/synth';

/* ── Types ─────────────────────────────────────────────────────────────── */

export type PitchMode = 'note' | 'chord';
export type AnswerInput = 'piano' | 'dial';
export type ChordFlavor = 'major' | 'minor' | 'both' | 'custom';
export type PlayStyle = 'block' | 'arpeggio';

export interface Question {
  id: number;
  kind: PitchMode;
  /** For note questions: the single MIDI note. */
  midi: number;
  /** For chord questions: voiced MIDI notes (may include inversions). */
  midis: number[];
  rootPc: number;
  quality: ChordQuality | null;
  instrument: InstrumentId | 'sample';
  sampleId: string | null;
  /** True when this question was chosen by the weakness model as a drill. */
  drilled: boolean;
  drillLabel?: string;
  askedAt: number;
}

export interface Attempt {
  id: number;
  question: Question;
  /** Pitch classes the player chose. */
  answerPcs: number[];
  answerMidis: number[];
  correct: boolean;
  /** 0..1 — full credit, or partial for near misses / right quality wrong root. */
  score: number;
  ms: number;
  at: number;
}

export interface PitchConfig {
  mode: PitchMode;
  chordFlavor: ChordFlavor;
  qualities: ChordQuality[];
  /**
   * Voice counts the chord generator may draw from. A set, not a single value:
   * one question can be a triad and the next a seventh. The flavour and the
   * scale are hard constraints in **both** modes — in note mode the question
   * pool is the union of the selected qualities' chord tones.
   */
  chordSizes: number[];
  useScale: boolean;
  scaleRoot: number;
  scaleName: ScaleName;
  octaveLow: number;
  octaveHigh: number;
  instruments: InstrumentId[];
  sampleIds: string[];
  playStyle: PlayStyle;
  /** Seconds the question sounds for. */
  sustain: number;
  answerInput: AnswerInput;
  /**
   * Sound a note when it is picked as an answer. Off by default: the question
   * and the dial's per-detent drag scrub are the only reference audio, so a
   * silent answer surface cannot be used to hunt for the answer by ear. The
   * dial scrub stays audible either way — it is a deliberate drag, not a pick.
   */
  auditionOnPick: boolean;
  /** Play the question again automatically before revealing. */
  replays: number;
  /** Show the answer immediately after submitting. */
  instantFeedback: boolean;
  /** Adaptive weighting strength, 0 = uniform, 1 = strongly targeted. */
  adaptivity: number;
  /** Restrict questions to an explicit drill pair, if set. */
  focusPair: [number, number] | null;
  /** Random detune (cents) applied to each question to defeat absolute pitch. */
  detuneJitter: number;
  /** Allow inversions / voicings of chords. */
  inversions: boolean;
}

export interface PitchStats {
  total: number;
  correct: number;
  score: number;
  streak: number;
  bestStreak: number;
  startedAt: number;
  /** Rolling latencies in ms. */
  latency: number[];
  byPc: { seen: number; correct: number }[];
  byQuality: Record<string, { seen: number; correct: number }>;
  byInstrument: Record<string, { seen: number; correct: number }>;
  byOctave: Record<string, { seen: number; correct: number }>;
}

export interface ConfusionPair {
  a: number;
  b: number;
  aToB: number;
  bToA: number;
  total: number;
  /** Combined error rate for the pair, 0..1 */
  error: number;
}

const emptyStats = (): PitchStats => ({
  total: 0,
  correct: 0,
  score: 0,
  streak: 0,
  bestStreak: 0,
  startedAt: Date.now(),
  latency: [],
  byPc: Array.from({ length: 12 }, () => ({ seen: 0, correct: 0 })),
  byQuality: {},
  byInstrument: {},
  byOctave: {},
});

const emptyMatrix = () => Array.from({ length: 12 }, () => new Array<number>(12).fill(0));
const emptyQualityMatrix = () => ({} as Record<string, Record<string, number>>);

const DEFAULT_CONFIG: PitchConfig = {
  mode: 'note',
  chordFlavor: 'both',
  qualities: ['maj', 'min'],
  chordSizes: [3],
  useScale: false,
  scaleRoot: 0,
  scaleName: 'major',
  octaveLow: 3,
  octaveHigh: 5,
  instruments: ['piano'],
  sampleIds: [],
  playStyle: 'block',
  sustain: 2.4,
  answerInput: 'piano',
  auditionOnPick: false,
  replays: 1,
  instantFeedback: true,
  adaptivity: 0.6,
  focusPair: null,
  detuneJitter: 0,
  inversions: false,
};

/* ── Persistence ───────────────────────────────────────────────────────── */

/** What `litedaw.pitch` actually stores (see `partialize`). */
interface PersistedPitch {
  cfg: PitchConfig;
  stats: PitchStats;
  confusion: number[][];
  qualityConfusion: Record<string, Record<string, number>>;
}

/** A config written by an older build: `chordSize` was a single number. */
type LegacyConfig = Partial<PitchConfig> & { chordSize?: number };

/**
 * Fold a stored (possibly legacy) configuration forward onto the current
 * defaults: a lone `chordSize` becomes the `chordSizes` set and any key added
 * since the payload was written is filled in. A missing key must never reach
 * the generator as `undefined`.
 */
function normalizeConfig(raw: LegacyConfig | undefined): PitchConfig {
  const merged: PitchConfig & { chordSize?: number } = { ...DEFAULT_CONFIG, ...(raw ?? {}) };
  const stored = raw?.chordSizes;
  merged.chordSizes = cleanChordSizes(
    Array.isArray(stored) ? stored : typeof raw?.chordSize === 'number' ? [raw.chordSize] : DEFAULT_CONFIG.chordSizes,
  );
  delete merged.chordSize;
  return merged;
}

/* ── Question generation helpers ───────────────────────────────────────── */

const MAJOR_SET: ChordQuality[] = ['maj', 'maj7', 'dom7', 'aug', 'sus4', 'sus2', 'six', 'add9', 'power'];
const MINOR_SET: ChordQuality[] = ['min', 'min7', 'dim', 'min7b5', 'min6', 'power'];

/** Every pitch class, ascending. */
export const ALL_PCS: number[] = Array.from({ length: 12 }, (_, i) => i);
/** Voice counts a chord question may use. */
export const CHORD_SIZE_CHOICES = [2, 3, 4, 5] as const;
export const MIN_CHORD_SIZE = CHORD_SIZE_CHOICES[0];
export const MAX_CHORD_SIZE = CHORD_SIZE_CHOICES[CHORD_SIZE_CHOICES.length - 1];

/** Legal voice counts: whole numbers inside the picker's range, deduped, sorted. */
export function cleanChordSizes(sizes: readonly number[] | undefined): number[] {
  const out = [...new Set((sizes ?? []).map((n) => Math.round(n)).filter((n) => Number.isFinite(n) && n >= MIN_CHORD_SIZE && n <= MAX_CHORD_SIZE))];
  out.sort((a, b) => a - b);
  return out.length ? out : [3];
}

/** Every quality the flavour selects, before the chord-size filter. */
export function flavorQualities(flavor: ChordFlavor, custom: ChordQuality[]): ChordQuality[] {
  const base =
    flavor === 'major' ? MAJOR_SET : flavor === 'minor' ? MINOR_SET : flavor === 'custom' ? custom : [...MAJOR_SET, ...MINOR_SET];
  const unique = [...new Set(base)];
  /* An empty `custom` selection must never produce an impossible question pool. */
  return unique.length ? unique : [...MAJOR_SET, ...MINOR_SET];
}

/**
 * Qualities of `flavor` whose voice count is one of `sizes`.
 * Falls back to the unfiltered flavour set when no quality matches — the
 * configuration panel warns about that case instead of the generator stalling.
 */
export function qualitiesFor(flavor: ChordFlavor, custom: ChordQuality[], sizes: readonly number[]): ChordQuality[] {
  const unique = flavorQualities(flavor, custom);
  const want = new Set(cleanChordSizes(sizes));
  const sized = unique.filter((q) => want.has(CHORD_INTERVALS[q].length));
  return sized.length ? sized : unique;
}

/**
 * The chord tones of the flavour: the union of the intervals of every quality
 * the flavour selects. This is the note-mode question pool and it deliberately
 * ignores the chord-size filter — voice counts shape the chords that are asked,
 * never which single notes are fair game.
 */
export function flavorPcs(cfg: PitchConfig): number[] {
  const set = new Set<number>();
  flavorQualities(cfg.chordFlavor, cfg.qualities).forEach((q) =>
    CHORD_INTERVALS[q].forEach((iv) => set.add(((iv % 12) + 12) % 12)),
  );
  return [...set].sort((a, b) => a - b);
}

/** Pitch classes of the configured scale. */
export function scalePcs(cfg: PitchConfig): number[] {
  const set = SCALES[cfg.scaleName] as readonly number[];
  return [...new Set(set.map((i) => (((cfg.scaleRoot + i) % 12) + 12) % 12))].sort((a, b) => a - b);
}

/**
 * Pitch classes a question may draw on.
 *
 * The chord flavour is a hard constraint on **both** modes:
 *  · note mode — the pool is the union of the chord tones of the selected
 *    qualities, so every single note that can be asked is a chord tone;
 *  · chord mode — the pool is the set of legal *roots* (any pitch class: the
 *    intervals are relative to the root), while the flavour constrains which
 *    qualities — and therefore which chord tones — can be asked.
 *
 * `Constrain to scale` layers on top as an intersection. It can never empty the
 * pool: when the scale excludes every candidate the scale layer is dropped and
 * `scaleConflicts()` reports it so the panel can warn.
 */
export function allowedPcs(cfg: PitchConfig): number[] {
  const base = cfg.mode === 'note' ? flavorPcs(cfg) : ALL_PCS;
  if (!base.length) return ALL_PCS;
  if (!cfg.useScale) return base;
  const scale = new Set(scalePcs(cfg));
  const hit = base.filter((pc) => scale.has(pc));
  return hit.length ? hit : base;
}

/** True when `Constrain to scale` would empty the pool and is being ignored. */
export function scaleConflicts(cfg: PitchConfig): boolean {
  if (!cfg.useScale) return false;
  const base = cfg.mode === 'note' ? flavorPcs(cfg) : ALL_PCS;
  const scale = new Set(scalePcs(cfg));
  return base.length > 0 && !base.some((pc) => scale.has(pc));
}

/**
 * Every pitch class a *correct* answer can contain. The answer surface gates on
 * this, so it can never offer a tone the generator will not ask — and never
 * hides a tone the answer needs. Note mode asks exactly `allowedPcs`; chord
 * mode asks every root × interval combination of the effective qualities.
 */
export function answerablePcs(cfg: PitchConfig): number[] {
  const roots = allowedPcs(cfg);
  if (cfg.mode === 'note') return roots;
  const qs = qualitiesFor(cfg.chordFlavor, cfg.qualities, cfg.chordSizes);
  const set = new Set<number>();
  roots.forEach((r) => qs.forEach((q) => CHORD_INTERVALS[q].forEach((iv) => set.add((((r + iv) % 12) + 12) % 12))));
  return [...set].sort((a, b) => a - b);
}

/**
 * Voice a quality from `rootMidi`, optionally inverted `inversions` times.
 *
 * The raw interval table cannot be inverted by adding 12 to its first entries:
 * `power` [0,7,12] and `add9` [0,4,7,14] already contain an octave doubling, so
 * that rotation produces the same MIDI number in two voices. Instead the lowest
 * voice is rotated up an octave once per inversion, deduped after every step,
 * and the result is guaranteed strictly ascending with no repeats.
 */
export function voiceChord(rootMidi: number, quality: ChordQuality, inversions = 0): number[] {
  const base = CHORD_INTERVALS[quality].map((i) => rootMidi + i);
  let v = [...new Set(base)].sort((a, b) => a - b);
  for (let k = 0; k < inversions && v.length > 2; k++) {
    const next = [...v];
    next[0] += 12;
    next.sort((a, b) => a - b);
    const uniq = [...new Set(next)];
    if (uniq.length < 2) break;
    v = uniq;
  }
  return v;
}

/** A voicing is legal when it is strictly ascending with no repeated note. */
export function isCleanVoicing(midis: readonly number[]): boolean {
  if (midis.length < 1) return false;
  for (let i = 1; i < midis.length; i++) if (midis[i] <= midis[i - 1]) return false;
  return true;
}

export function rangeMidis(cfg: PitchConfig): number[] {
  const out: number[] = [];
  const lo = Math.min(cfg.octaveLow, cfg.octaveHigh);
  const hi = Math.max(cfg.octaveLow, cfg.octaveHigh);
  for (let o = lo; o <= hi; o++) {
    for (let pc = 0; pc < 12; pc++) out.push((o + 1) * 12 + pc);
  }
  return out;
}

/** Weighted pick using a random source. */
function pickWeighted<T>(items: T[], weights: number[], rnd = Math.random): T {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(rnd() * items.length)];
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/* ── Store ─────────────────────────────────────────────────────────────── */

interface PitchStore {
  cfg: PitchConfig;
  question: Question | null;
  phase: 'idle' | 'playing' | 'answering' | 'revealed';
  /**
   * Epoch ms at which the current round entered `answering`, or 0 when no
   * round is being answered. Kept in the store (not a page ref) because the
   * store outlives page mounts — the elapsed timer must never be measured from
   * an unset start, which reads as "since 1970".
   */
  answerStartedAt: number;
  attempts: Attempt[];
  stats: PitchStats;
  confusion: number[][];
  qualityConfusion: Record<string, Record<string, number>>;
  /** True when the last answer was correct, for UI feedback. */
  lastResult: { correct: boolean; score: number } | null;
  /** Frozen snapshot of the previous question for the A/B replay button. */
  previous: Question | null;

  setCfg: <K extends keyof PitchConfig>(key: K, value: PitchConfig[K]) => void;
  resetConfig: () => void;
  setPhase: (p: PitchStore['phase']) => void;
  nextQuestion: () => Question;
  setQuestion: (q: Question | null) => void;
  record: (a: Attempt) => void;
  resetSession: () => void;
  resetModel: () => void;
  /** Ranked list of the pairs the player most often confuses. */
  weakPairs: (limit?: number) => ConfusionPair[];
  /** Per-pitch-class accuracy, 0..1 (null when unseen). */
  pcAccuracy: () => (number | null)[];
  accuracy: () => number;
  exportProfile: () => string;
  importProfile: (json: string) => boolean;
}

let qid = 1;

export const usePitch = create<PitchStore>()(
  persist(
    (set, get) => ({
      cfg: { ...DEFAULT_CONFIG },
      question: null,
      phase: 'idle',
      answerStartedAt: 0,
      attempts: [],
      stats: emptyStats(),
      confusion: emptyMatrix(),
      qualityConfusion: emptyQualityMatrix(),
      lastResult: null,
      previous: null,

      setCfg: (key, value) => set((s) => ({ cfg: { ...s.cfg, [key]: value } })),
      resetConfig: () => set({ cfg: { ...DEFAULT_CONFIG } }),
      /* Entering `answering` stamps the clock once; leaving it clears the stamp
         so a stale start can never be read back by a later round. */
      setPhase: (phase) =>
        set((s) => ({
          phase,
          answerStartedAt: phase === 'answering' ? (s.phase === 'answering' ? s.answerStartedAt : Date.now()) : 0,
        })),
      setQuestion: (question) => set({ question }),

      nextQuestion: () => {
        const { cfg, confusion } = get();
        const instrChoices: (InstrumentId | 'sample')[] = [...cfg.instruments];
        if (cfg.sampleIds.length) instrChoices.push('sample');
        const instrument = instrChoices.length
          ? instrChoices[Math.floor(Math.random() * instrChoices.length)]
          : 'piano';
        const sampleId = instrument === 'sample' ? cfg.sampleIds[Math.floor(Math.random() * cfg.sampleIds.length)] ?? null : null;

        const pool = rangeMidis(cfg);
        const pcs = new Set(allowedPcs(cfg));

        let drilled = false;
        let drillLabel: string | undefined;

        if (cfg.mode === 'note') {
          /* ── Weakness-weighted pitch class choice ───────────────────── */
          const candidates = ALL_PCS.filter((pc) => pcs.has(pc));
          const candSet = new Set(candidates);
          const rowTotals = confusion.map((row) => row.reduce((a, b) => a + b, 0));
          const rowErr = confusion.map((row, i) => {
            const tot = rowTotals[i];
            if (tot < 2) return 0.35; // unseen classes get a mild curiosity bonus
            const off = row.reduce((a, b, j) => (i === j ? a : a + b), 0);
            return off / tot;
          });

          /* A drill may name a class the current flavour excludes — keep the
             half of the pair that is legal rather than asking an impossible
             note (the pool is a hard constraint in both modes). */
          const focus = (cfg.focusPair ?? []).filter((pc) => candSet.has(pc));
          let targetPc: number;
          const rnd = Math.random();
          if (focus.length && rnd < 0.75) {
            targetPc = focus[Math.floor(Math.random() * focus.length)];
            drilled = true;
            drillLabel = cfg.focusPair
              ? `${pitchClassName(cfg.focusPair[0])} vs ${pitchClassName(cfg.focusPair[1])}`
              : `weakest class ${pitchClassName(targetPc)}`;
          } else if (rnd < cfg.adaptivity) {
            const weights = candidates.map((pc) => 0.25 + rowErr[pc] * 3.4);
            targetPc = pickWeighted(candidates, weights);
            drilled = rowErr[targetPc] > 0.5;
            if (drilled) drillLabel = `weakest class ${pitchClassName(targetPc)}`;
          } else {
            targetPc = candidates[Math.floor(Math.random() * candidates.length)];
          }

          const noteChoices = pool.filter((m) => ((m % 12) + 12) % 12 === targetPc);
          const midi = noteChoices.length
            ? noteChoices[Math.floor(Math.random() * noteChoices.length)]
            : 60 + targetPc;

          const q: Question = {
            id: qid++,
            kind: 'note',
            midi,
            midis: [midi],
            rootPc: targetPc,
            quality: null,
            instrument,
            sampleId,
            drilled,
            drillLabel,
            askedAt: Date.now(),
          };
          set((s) => ({ question: q, previous: s.question, phase: 'playing', lastResult: null, answerStartedAt: 0 }));
          return q;
        }

        /* ── Chord question ──────────────────────────────────────────── */
        /* Mixed sizes: one voice count is drawn per question, then the
           qualities that can actually be voiced that way. A size with no
           quality behind it is simply never drawn. */
        const flavour = flavorQualities(cfg.chordFlavor, cfg.qualities);
        const groups = cleanChordSizes(cfg.chordSizes)
          .map((size) => flavour.filter((q) => CHORD_INTERVALS[q].length === size))
          .filter((qs) => qs.length > 0);
        const qs = groups.length ? groups[Math.floor(Math.random() * groups.length)] : flavour;

        const qc = get().qualityConfusion;
        const qualityWeights = qs.map((q) => {
          const row = qc[q] ?? {};
          const tot = Object.values(row).reduce((a, b) => a + b, 0);
          if (tot < 2) return 1;
          const ok = row[q] ?? 0;
          return 0.3 + (1 - ok / tot) * 3;
        });
        const quality = pickWeighted(qs, qualityWeights);
        const intervals = CHORD_INTERVALS[quality];
        const roots = ALL_PCS.filter((pc) => pcs.has(pc));
        const rootPc = roots[Math.floor(Math.random() * roots.length)];

        /* Voicing, then range. An inversion lifts the top voice by up to an
           octave, so an inverted chord needs its root that much lower; when the
           configured range cannot hold it the inversion is dropped rather than
           the chord being truncated at the 108 ceiling (which used to leave a
           "chord" of one or two notes). */
        const top = Math.max(...intervals);
        let invert =
          cfg.inversions && intervals.length > 2 && Math.random() < 0.5
            ? 1 + Math.floor(Math.random() * (intervals.length - 1))
            : 0;
        const rootAt = (allowance: number) => {
          const fit = pool.filter((m) => ((m % 12) + 12) % 12 === rootPc && m + top + allowance <= 108);
          return fit.length ? fit[Math.floor(Math.random() * fit.length)] : null;
        };
        let rootMidi = rootAt(invert ? 12 : 0);
        if (rootMidi === null) {
          invert = 0;
          rootMidi = rootAt(0);
        }
        if (rootMidi === null) {
          /* The whole range sits above the chord: use the highest root that fits. */
          let m = 108 - top;
          while (m > 24 && ((m % 12) + 12) % 12 !== rootPc) m -= 1;
          rootMidi = m;
        }

        let midis = voiceChord(rootMidi, quality, invert);
        if (!isCleanVoicing(midis)) midis = voiceChord(rootMidi, quality, 0);
        /* Last guard: slide the voicing down in octaves until it is on the
           keyboard. The pc set — everything grading cares about — is unchanged. */
        while (Math.max(...midis) > 108 && Math.min(...midis) - 12 >= 12) {
          midis = midis.map((m) => m - 12);
          rootMidi -= 12;
        }
        midis = midis.filter((m) => m >= 12 && m <= 108);

        const q: Question = {
          id: qid++,
          kind: 'chord',
          midi: rootMidi,
          midis,
          rootPc,
          quality,
          instrument,
          sampleId,
          drilled: false,
          askedAt: Date.now(),
        };
        set((s) => ({ question: q, previous: s.question, phase: 'playing', lastResult: null, answerStartedAt: 0 }));
        return q;
      },

      record: (a) =>
        set((s) => {
          const stats: PitchStats = {
            ...s.stats,
            total: s.stats.total + 1,
            correct: s.stats.correct + (a.correct ? 1 : 0),
            score: s.stats.score + a.score,
            streak: a.correct ? s.stats.streak + 1 : 0,
            bestStreak: Math.max(s.stats.bestStreak, a.correct ? s.stats.streak + 1 : 0),
            latency: [...s.stats.latency.slice(-199), a.ms],
            byPc: s.stats.byPc.map((v, i) =>
              i === a.question.rootPc ? { seen: v.seen + 1, correct: v.correct + (a.correct ? 1 : 0) } : v,
            ),
            byQuality: { ...s.stats.byQuality },
            byInstrument: { ...s.stats.byInstrument },
            byOctave: { ...s.stats.byOctave },
          };

          if (a.question.quality) {
            const k = a.question.quality;
            const prev = stats.byQuality[k] ?? { seen: 0, correct: 0 };
            stats.byQuality[k] = { seen: prev.seen + 1, correct: prev.correct + (a.correct ? 1 : 0) };
          }
          const ikey = String(a.question.instrument);
          const iprev = stats.byInstrument[ikey] ?? { seen: 0, correct: 0 };
          stats.byInstrument[ikey] = { seen: iprev.seen + 1, correct: iprev.correct + (a.correct ? 1 : 0) };
          const okey = String(Math.floor(a.question.midi / 12) - 1);
          const oprev = stats.byOctave[okey] ?? { seen: 0, correct: 0 };
          stats.byOctave[okey] = { seen: oprev.seen + 1, correct: oprev.correct + (a.correct ? 1 : 0) };

          /* ── Update the confusion model ─────────────────────────────── */
          const confusion = s.confusion.map((r) => r.slice());
          const qualityConfusion = { ...s.qualityConfusion };
          if (a.question.kind === 'note' && a.answerPcs.length) {
            const target = a.question.rootPc;
            // Credit the closest answered class so a near miss is recorded as
            // "C heard as C#" rather than as an unrelated error.
            const nearest = a.answerPcs.reduce((best, pc) => {
              const d = Math.min(Math.abs(pc - target), 12 - Math.abs(pc - target));
              const bd = Math.min(Math.abs(best - target), 12 - Math.abs(best - target));
              return d < bd ? pc : best;
            }, a.answerPcs[0]);
            confusion[target][nearest] += 1;
          }
          if (a.question.kind === 'chord' && a.question.quality) {
            const row = { ...(qualityConfusion[a.question.quality] ?? {}) };
            const ansKey = a.correct
              ? a.question.quality
              : guessQualityFromPcs(a.answerPcs, a.question.rootPc) ?? 'other';
            row[ansKey] = (row[ansKey] ?? 0) + 1;
            qualityConfusion[a.question.quality] = row;
          }

          return {
            attempts: [...s.attempts.slice(-299), a],
            stats,
            confusion,
            qualityConfusion,
            phase: 'revealed' as const,
            answerStartedAt: 0,
            lastResult: { correct: a.correct, score: a.score },
          };
        }),

      resetSession: () =>
        set({
          attempts: [],
          stats: emptyStats(),
          question: null,
          phase: 'idle',
          answerStartedAt: 0,
          lastResult: null,
          previous: null,
        }),

      resetModel: () => set({ confusion: emptyMatrix(), qualityConfusion: emptyQualityMatrix() }),

      weakPairs: (limit = 6) => {
        const m = get().confusion;
        const out: ConfusionPair[] = [];
        for (let a = 0; a < 12; a++) {
          for (let b = a + 1; b < 12; b++) {
            const aToB = m[a][b];
            const bToA = m[b][a];
            const total = aToB + bToA;
            if (total === 0) continue;
            const seenA = m[a].reduce((x, y) => x + y, 0);
            const seenB = m[b].reduce((x, y) => x + y, 0);
            const denom = Math.max(1, Math.min(seenA, seenB));
            out.push({ a, b, aToB, bToA, total, error: Math.min(1, total / denom) });
          }
        }
        return out.sort((x, y) => y.total * y.error - x.total * x.error).slice(0, limit);
      },

      pcAccuracy: () => {
        const { confusion } = get();
        return confusion.map((row, i) => {
          const tot = row.reduce((a, b) => a + b, 0);
          if (tot === 0) return null;
          return row[i] / tot;
        });
      },

      accuracy: () => {
        const s = get().stats;
        return s.total ? s.correct / s.total : 0;
      },

      exportProfile: () => {
        const { stats, confusion, qualityConfusion, cfg } = get();
        return JSON.stringify(
          { version: 1, exportedAt: new Date().toISOString(), stats, confusion, qualityConfusion, cfg },
          null,
          2,
        );
      },

      importProfile: (json) => {
        try {
          const data = JSON.parse(json) as Partial<{
            stats: PitchStats;
            confusion: number[][];
            qualityConfusion: Record<string, Record<string, number>>;
            cfg: LegacyConfig;
          }>;
          set((s) => ({
            stats: data.stats ?? s.stats,
            confusion: data.confusion ?? s.confusion,
            qualityConfusion: data.qualityConfusion ?? s.qualityConfusion,
            cfg: data.cfg ? normalizeConfig({ ...s.cfg, ...data.cfg }) : s.cfg,
          }));
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: 'litedaw.pitch',
      version: 4,
      /* v3 stored a single `chordSize`; v4 stores the `chordSizes` set and the
         `auditionOnPick` switch. Anything older than 4 is folded forward here
         instead of being thrown away. */
      migrate: (persisted): PersistedPitch => {
        const p = (persisted ?? {}) as Partial<PersistedPitch>;
        return {
          cfg: normalizeConfig(p.cfg as LegacyConfig | undefined),
          stats: p.stats ?? emptyStats(),
          confusion: p.confusion ?? emptyMatrix(),
          qualityConfusion: p.qualityConfusion ?? emptyQualityMatrix(),
        };
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PersistedPitch>;
        return { ...current, ...p, cfg: normalizeConfig(p.cfg as LegacyConfig | undefined) };
      },
      partialize: (s): PersistedPitch => ({
        cfg: s.cfg,
        stats: s.stats,
        confusion: s.confusion,
        qualityConfusion: s.qualityConfusion,
      }),
    },
  ),
);

/** Best-effort reverse lookup of which chord quality a pitch-class set spells. */
function guessQualityFromPcs(pcs: number[], rootPc: number): ChordQuality | null {
  if (!pcs.length) return null;
  const rel = [...new Set(pcs.map((pc) => ((pc - rootPc) % 12 + 12) % 12))].sort((a, b) => a - b);
  let best: ChordQuality | null = null;
  let bestScore = Infinity;
  (Object.keys(CHORD_INTERVALS) as ChordQuality[]).forEach((q) => {
    const iv = [...new Set(CHORD_INTERVALS[q].map((i) => i % 12))].sort((a, b) => a - b);
    const missing = iv.filter((x) => !rel.includes(x)).length;
    const extra = rel.filter((x) => !iv.includes(x)).length;
    const score = missing + extra;
    if (score < bestScore) {
      bestScore = score;
      best = q;
    }
  });
  return best;
}

/* ── Scoring ───────────────────────────────────────────────────────────── */

export interface GradeInput {
  question: Question;
  answerMidis: number[];
  ms: number;
}

export interface GradeResult {
  correct: boolean;
  score: number;
  detail: string;
}

/** Grades an answer with partial credit for near misses and right-set-wrong-root. */
export function gradeAnswer({ question, answerMidis, ms }: GradeInput): GradeResult {
  const ansPcs = [...new Set(answerMidis.map((m) => ((m % 12) + 12) % 12))];
  const targetPcs = [...new Set(question.midis.map((m) => ((m % 12) + 12) % 12))];

  if (question.kind === 'note') {
    const target = question.rootPc;
    if (ansPcs.length === 0) return { correct: false, score: 0, detail: 'No answer given' };
    const hit = ansPcs.includes(target);
    if (hit) {
      const speedBonus = ms < 1600 ? 1 : ms < 3200 ? 0.96 : 0.92;
      return { correct: true, score: speedBonus, detail: `${pitchClassName(target)} — correct` };
    }
    const dist = Math.min(...ansPcs.map((pc) => Math.min(Math.abs(pc - target), 12 - Math.abs(pc - target))));
    const partial = dist === 1 ? 0.35 : dist === 2 ? 0.15 : 0;
    return {
      correct: false,
      score: partial,
      detail: `Heard ${ansPcs.map(pitchClassName).join('/')} · target ${pitchClassName(target)} (${dist} semitone${dist > 1 ? 's' : ''} off)`,
    };
  }

  const setMatch = ansPcs.length === targetPcs.length && targetPcs.every((pc) => ansPcs.includes(pc));
  const q = question.quality;
  if (setMatch && q) {
    return { correct: true, score: 1, detail: `${chordName(question.midi, q)} — correct` };
  }
  // Right root, wrong quality
  if (q && ansPcs.includes(question.rootPc) && ansPcs.length >= 2) {
    return {
      correct: false,
      score: 0.4,
      detail: `Root correct, quality off — target ${chordName(question.midi, q)}`,
    };
  }
  return {
    correct: false,
    score: 0,
    detail: q ? `Target ${chordName(question.midi, q)}` : 'Incorrect',
  };
}

export const chordLabel = (q: ChordQuality) => CHORD_LABELS[q];
export const noteFrequency = midiToFreq;
export const ALL_QUALITIES = Object.keys(CHORD_INTERVALS) as ChordQuality[];
