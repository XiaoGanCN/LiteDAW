/* ============================================================================
   LiteDAW · BPM TRAINER STATE
   Tempo-identification and tap-tempo drills with a region-weighted difficulty
   model: tempos the player repeatedly misjudges come back more often.
   ========================================================================= */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ClickSound } from '../audio/metronome';

export type BpmMode = 'identify' | 'tap';

export interface BpmConfig {
  mode: BpmMode;
  minBpm: number;
  maxBpm: number;
  /** Allowed time-signature numerators. */
  numerators: number[];
  /** Allowed denominators (note value that gets the beat). */
  denominators: number[];
  /** Allowed subdivision counts. */
  subdivisions: number[];
  downbeatOnly: boolean;
  sounds: ClickSound[];
  /** Bars to play before the reference stops (0 = runs until answered). */
  bars: number;
  /** Seconds the player gets in tap mode before scoring. */
  tapWindow: number;
  /** Accepted absolute error, in BPM, for a "correct" verdict. */
  tolerance: number;
  /** Probability of re-asking a tempo from a weak region. */
  adaptivity: number;
}

export interface BpmRound {
  target: number;
  answer: number;
  errorBpm: number;
  errorPct: number;
  correct: boolean;
  ms: number;
  numerator: number;
  denominator: number;
  subdivision: number;
  sound: ClickSound;
  at: number;
}

export interface BpmStats {
  rounds: number;
  correct: number;
  bestErrorPct: number;
  /** Sum of |error%| for an average. */
  errorSum: number;
  /** 12 buckets across the configured range. */
  regions: { seen: number; errorSum: number }[];
  history: BpmRound[];
}

const emptyStats = (): BpmStats => ({
  rounds: 0,
  correct: 0,
  bestErrorPct: Infinity,
  errorSum: 0,
  regions: Array.from({ length: 12 }, () => ({ seen: 0, errorSum: 0 })),
  history: [],
});

export const DEFAULT_BPM_CONFIG: BpmConfig = {
  mode: 'identify',
  minBpm: 60,
  maxBpm: 180,
  numerators: [4, 3],
  denominators: [4],
  subdivisions: [1, 2],
  downbeatOnly: false,
  sounds: ['beep', 'wood'],
  bars: 4,
  tapWindow: 12,
  tolerance: 2,
  adaptivity: 0.55,
};

/** Hard bounds of the tempo-range control (and of the answer dial's sweep). */
export const BPM_FLOOR = 20;
export const BPM_CEIL = 400;
/** Smallest allowed min↔max gap so the 12-region model keeps a usable span. */
export const BPM_MIN_SPAN = 5;

/** Clamps a min/max pair into the legal bounds while preserving min < max. */
export function normalizeRange(min: number, max: number): { minBpm: number; maxBpm: number } {
  const r = (v: number) => Math.round(Math.max(BPM_FLOOR, Math.min(BPM_CEIL, Number.isFinite(v) ? v : BPM_FLOOR)));
  let a = r(min);
  let b = r(max);
  if (b < a) [a, b] = [b, a];
  if (b - a < BPM_MIN_SPAN) {
    // Open the span: borrow from below the low end first, then above the high one.
    const need = BPM_MIN_SPAN - (b - a);
    const down = Math.min(need, a - BPM_FLOOR);
    a -= down;
    b += Math.min(need - down, BPM_CEIL - b);
  }
  return { minBpm: a, maxBpm: b };
}

/** Which surface the player dials the answer on. */
export type AnswerSurface = 'wheel' | 'dial';

export interface BpmUi {
  /** Beat visualiser (pendulum + lamps). Off by default: pure listening. */
  visOn: boolean;
  /** Last answer-entry surface used — remembered across sessions. */
  surface: AnswerSurface;
}

export const DEFAULT_BPM_UI: BpmUi = { visOn: false, surface: 'wheel' };

export interface ActiveRound {
  target: number;
  numerator: number;
  denominator: number;
  subdivision: number;
  sound: ClickSound;
  startedAt: number;
  /** Context time the reference playback ends (0 = open ended). */
  endsAt: number;
  taps: number[];
}

interface BpmStore {
  cfg: BpmConfig;
  ui: BpmUi;
  phase: 'idle' | 'listening' | 'answering' | 'revealed' | 'tapping';
  round: ActiveRound | null;
  lastRound: BpmRound | null;
  stats: BpmStats;
  setCfg: <K extends keyof BpmConfig>(key: K, value: BpmConfig[K]) => void;
  setUi: <K extends keyof BpmUi>(key: K, value: BpmUi[K]) => void;
  resetConfig: () => void;
  begin: (r: ActiveRound) => void;
  setPhase: (p: BpmStore['phase']) => void;
  finish: (r: BpmRound) => void;
  resetSession: () => void;
  resetModel: () => void;
  /** Picks the next tempo, biased toward weak regions of the range. */
  nextTarget: () => { bpm: number; numerator: number; denominator: number; subdivision: number; sound: ClickSound };
  accuracy: () => number;
  meanErrorPct: () => number;
}

const REGIONS = 12;

function regionOf(bpm: number, min: number, max: number) {
  const t = (bpm - min) / Math.max(1, max - min);
  return Math.max(0, Math.min(REGIONS - 1, Math.floor(t * REGIONS)));
}

export const useBpm = create<BpmStore>()(
  persist(
    (set, get) => ({
      cfg: { ...DEFAULT_BPM_CONFIG },
      ui: { ...DEFAULT_BPM_UI },
      phase: 'idle',
      round: null,
      lastRound: null,
      stats: emptyStats(),

      setCfg: (key, value) => set((s) => ({ cfg: { ...s.cfg, [key]: value } })),
      setUi: (key, value) => set((s) => ({ ui: { ...s.ui, [key]: value } })),
      resetConfig: () => set({ cfg: { ...DEFAULT_BPM_CONFIG } }),
      begin: (round) => set({ round, phase: 'listening', lastRound: null }),
      setPhase: (phase) => set({ phase }),

      finish: (r) =>
        set((s) => {
          const cfg = s.cfg;
          const ridx = regionOf(r.target, cfg.minBpm, cfg.maxBpm);
          const regions = s.stats.regions.map((v, i) =>
            i === ridx ? { seen: v.seen + 1, errorSum: v.errorSum + r.errorPct } : v,
          );
          return {
            lastRound: r,
            phase: 'revealed',
            round: null,
            stats: {
              rounds: s.stats.rounds + 1,
              correct: s.stats.correct + (r.correct ? 1 : 0),
              bestErrorPct: Math.min(s.stats.bestErrorPct, r.errorPct),
              errorSum: s.stats.errorSum + r.errorPct,
              regions,
              history: [...s.stats.history.slice(-299), r],
            },
          };
        }),

      resetSession: () => set({ round: null, lastRound: null, phase: 'idle', stats: emptyStats() }),
      resetModel: () => set({ stats: emptyStats() }),

      nextTarget: () => {
        const { cfg, stats } = get();
        const lo = Math.min(cfg.minBpm, cfg.maxBpm);
        const hi = Math.max(cfg.minBpm, cfg.maxBpm);
        const span = Math.max(1, hi - lo);

        // Weighted pick over a 1 BPM grid, favouring regions with high error.
        const weights: number[] = [];
        const values: number[] = [];
        const step = span > 160 ? 3 : span > 80 ? 2 : 1;
        for (let bpm = lo; bpm <= hi; bpm += step) {
          values.push(bpm);
          const r = stats.regions[regionOf(bpm, lo, hi)];
          const err = r.seen ? Math.min(60, r.errorSum / r.seen) : 12;
          weights.push(0.22 + (err / 60) * 2.6);
        }
        const useAdaptive = Math.random() < cfg.adaptivity;
        const arr = useAdaptive ? weights : values.map(() => 1);
        const total = arr.reduce((a, b) => a + b, 0);
        let roll = Math.random() * total;
        let bpm = values[0];
        for (let i = 0; i < values.length; i++) {
          roll -= arr[i];
          if (roll <= 0) {
            bpm = values[i];
            break;
          }
        }
        const pick = <T,>(xs: T[], fallback: T) => (xs.length ? xs[Math.floor(Math.random() * xs.length)] : fallback);
        return {
          bpm,
          numerator: pick(cfg.numerators, 4),
          denominator: pick(cfg.denominators, 4),
          subdivision: pick(cfg.subdivisions, 1),
          sound: pick(cfg.sounds, 'beep'),
        };
      },

      accuracy: () => {
        const s = get().stats;
        return s.rounds ? s.correct / s.rounds : 0;
      },

      meanErrorPct: () => {
        const s = get().stats;
        return s.rounds ? s.errorSum / s.rounds : 0;
      },
    }),
    {
      name: 'litedaw.bpm',
      version: 3,
      partialize: (s) => ({ cfg: s.cfg, stats: s.stats, ui: s.ui }),
      /**
       * v2 shipped before the UI slice existed, and the beat visualiser used to
       * default to on. Keep every logged round but fold the new slice in with
       * its (off) defaults rather than throwing the model away.
       */
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<{ cfg: BpmConfig; stats: BpmStats; ui: BpmUi }>;
        if (version < 3) return { ...p, ui: { ...DEFAULT_BPM_UI, ...p.ui } };
        return p;
      },
    },
  ),
);

/** Tempo marking names for the readout — helps players build a vocabulary. */
export const TEMPO_MARKS: { max: number; name: string; it: string }[] = [
  { max: 24, name: 'Larghissimo', it: 'very, very slow' },
  { max: 40, name: 'Grave', it: 'slow and solemn' },
  { max: 45, name: 'Largo', it: 'broad' },
  { max: 60, name: 'Larghetto', it: 'rather broadly' },
  { max: 66, name: 'Adagio', it: 'slow and stately' },
  { max: 76, name: 'Andante', it: 'at a walking pace' },
  { max: 108, name: 'Moderato', it: 'moderately' },
  { max: 120, name: 'Allegretto', it: 'moderately fast' },
  { max: 156, name: 'Allegro', it: 'fast and bright' },
  { max: 176, name: 'Vivace', it: 'lively and fast' },
  { max: 200, name: 'Presto', it: 'very, very fast' },
  { max: 999, name: 'Prestissimo', it: 'extremely fast' },
];

export const tempoMark = (bpm: number) => TEMPO_MARKS.find((t) => bpm <= t.max) ?? TEMPO_MARKS[TEMPO_MARKS.length - 1];
