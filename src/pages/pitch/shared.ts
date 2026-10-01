/* ============================================================================
   LiteDAW · PITCH PAGE — shared helpers
   Range maths, data-driven colours and small formatters. Nothing here touches
   the store or the audio graph.
   ========================================================================= */

import {
  CHORD_INTERVALS,
  CHORD_LABELS,
  PC_NAMES,
  SCALES,
  midiName,
  type ChordQuality,
  type ScaleName,
} from '../../audio/dsp';
import { INSTRUMENTS, type InstrumentId } from '../../audio/synth';
import { samples } from '../../audio/sampler';
import { qualitiesFor, type PitchConfig, type Question } from '../../state/pitch';

export { PC_NAMES };

/* ── Instrument labels ─────────────────────────────────────────────────── */

export function instrumentLabel(id: InstrumentId | 'sample'): string {
  if (id === 'sample') return 'Sample';
  return INSTRUMENTS.find((i) => i.id === id)?.label ?? id;
}

export function voiceLabel(q: Question): string {
  if (q.instrument === 'sample') {
    return samples.get(q.sampleId)?.name ?? 'sample (missing)';
  }
  return instrumentLabel(q.instrument);
}

export const FAMILIES: { family: string; items: typeof INSTRUMENTS }[] = (() => {
  const order: string[] = [];
  INSTRUMENTS.forEach((i) => {
    if (!order.includes(i.family)) order.push(i.family);
  });
  return order.map((family) => ({ family, items: INSTRUMENTS.filter((i) => i.family === family) }));
})();

/* ── Range maths ───────────────────────────────────────────────────────── */

export interface Bounds {
  low: number;
  high: number;
  octaveLow: number;
  octaveHigh: number;
}

export function boundsOf(cfg: PitchConfig): Bounds {
  const oLo = Math.max(0, Math.min(7, Math.min(cfg.octaveLow, cfg.octaveHigh)));
  const oHi = Math.max(0, Math.min(7, Math.max(cfg.octaveLow, cfg.octaveHigh)));
  return {
    octaveLow: oLo,
    octaveHigh: oHi,
    low: (oLo + 1) * 12,
    high: Math.min(108, (oHi + 1) * 12 + 11),
  };
}

const pcOf = (midi: number) => ((midi % 12) + 12) % 12;

/** Lowest key inside the configured range that carries `pc`. */
export function midiForPc(pc: number, cfg: PitchConfig): number {
  const { low, high } = boundsOf(cfg);
  for (let m = low; m <= high; m++) if (pcOf(m) === pc) return m;
  return 60 + (((pc % 12) + 12) % 12);
}

/** All pitch classes the current scale/range permits. */
export function allowedPcSet(cfg: PitchConfig): Set<number> {
  if (!cfg.useScale) return new Set(Array.from({ length: 12 }, (_, i) => i));
  const set = SCALES[cfg.scaleName] as readonly number[];
  return new Set(set.map((i) => (cfg.scaleRoot + i) % 12));
}

export const scaleOptions = (Object.keys(SCALES) as ScaleName[]).map((k) => ({
  value: k,
  label: k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()),
}));

/* ── Chord helpers ─────────────────────────────────────────────────────── */

export const ALL_QUALITIES = Object.keys(CHORD_INTERVALS) as ChordQuality[];

export function activeQualities(cfg: PitchConfig): ChordQuality[] {
  return qualitiesFor(cfg.chordFlavor, cfg.qualities, cfg.chordSize);
}

/** `R · 4 · 7` */
export function intervalFormula(q: ChordQuality | null): string {
  if (!q) return '';
  return CHORD_INTERVALS[q].map((i) => (i === 0 ? 'R' : String(i))).join(' · ');
}

export function qualityLabel(q: ChordQuality): string {
  return CHORD_LABELS[q];
}

/* ── Data-driven colours ───────────────────────────────────────────────── */

/** Off-diagonal confusion heat: transparent → saturated signal red. */
export function heatCell(t: number): string {
  const a = Math.min(1, Math.max(0, t));
  const r = Math.round(120 + 120 * a);
  const g = Math.round(20 + 22 * a);
  const b = Math.round(34 + 34 * a);
  return `rgba(${r}, ${g}, ${b}, ${(0.1 + 0.82 * a).toFixed(3)})`;
}

/** Diagonal (correct) heat: green. */
export function heatDiag(t: number): string {
  const a = Math.min(1, Math.max(0, t));
  return `rgba(34, 224, 124, ${(0.08 + 0.6 * a).toFixed(3)})`;
}

/** Accuracy 0..1 → green→amber→red. `null` renders as an empty well. */
export function accColor(a: number | null): string {
  if (a === null) return 'rgba(140,160,175,.10)';
  const hue = Math.round(Math.min(1, Math.max(0, a)) * 132);
  return `hsl(${hue} 78% 46% / 0.9)`;
}

export function accInk(a: number | null): string {
  if (a === null) return 'var(--ink-ghost)';
  const hue = Math.round(Math.min(1, Math.max(0, a)) * 132);
  return `hsl(${hue} 90% 72%)`;
}

/* ── Formatters ────────────────────────────────────────────────────────── */

export const pct = (v: number, digits = 0) => `${(v * 100).toFixed(digits)}%`;

export const ms = (v: number) => (v >= 10000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);

export const hz = (midi: number) => {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  return f >= 1000 ? `${f.toFixed(1)}` : `${f.toFixed(2)}`;
};

export const noteName = midiName;

export const secs = (s: number) => `${s.toFixed(2)}s`;

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
