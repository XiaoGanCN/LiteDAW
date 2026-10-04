/* ============================================================================
   LiteDAW · DSP UTILITIES
   Offline, allocation-light helpers: granular pitch shifting, linear resample,
   fades, normalisation and peak analysis. Used by clip processing and export.
   ========================================================================= */

/** Linear-interpolating sample read. */
function lerpAt(data: Float32Array, pos: number): number {
  const i = Math.floor(pos);
  if (i < 0) return 0;
  if (i >= data.length - 1) return data[data.length - 1] ?? 0;
  const f = pos - i;
  return data[i] * (1 - f) + data[i + 1] * f;
}

/** Raised-cosine (Hann) window value at normalised position 0..1. */
const hann = (x: number) => 0.5 - 0.5 * Math.cos(2 * Math.PI * x);

/**
 * Granular overlap-add pitch shifter.
 * Shifts pitch by `semitones` while preserving duration. Quality is
 * deliberately "characterful" — grain size and overlap are exposed so the
 * inspector can trade artefacts for transparency.
 */
export function pitchShiftBuffer(
  input: Float32Array,
  sampleRate: number,
  semitones: number,
  grainMs = 78,
  overlap = 4,
): Float32Array {
  if (Math.abs(semitones) < 0.001) return input;
  const ratio = Math.pow(2, semitones / 12);
  const grain = Math.max(64, Math.round((grainMs / 1000) * sampleRate));
  const hop = Math.max(1, Math.round(grain / overlap));
  const out = new Float32Array(input.length + grain * 2);
  const norm = new Float32Array(out.length);

  for (let outPos = 0, inPos = 0; inPos < input.length; outPos += hop, inPos += hop) {
    const readLen = grain * ratio;
    for (let i = 0; i < grain; i++) {
      const src = inPos + (i / grain) * readLen;
      const w = hann(i / grain);
      const o = outPos + i;
      if (o >= out.length) break;
      out[o] += lerpAt(input, src) * w;
      norm[o] += w;
    }
  }

  const result = new Float32Array(input.length);
  for (let i = 0; i < result.length; i++) {
    result[i] = norm[i] > 0.0001 ? out[i] / norm[i] : 0;
  }
  return result;
}

/** Simple tape-style resample by an arbitrary (fractional) factor. */
export function resampleLinear(input: Float32Array, factor: number): Float32Array {
  if (Math.abs(factor - 1) < 1e-6) return input;
  const outLen = Math.max(1, Math.round(input.length / factor));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = lerpAt(input, i * factor);
  return out;
}

/** Applies a linear fade in/out in seconds. */
export function applyFades(
  data: Float32Array,
  sampleRate: number,
  fadeInSec: number,
  fadeOutSec: number,
): void {
  const fi = Math.min(data.length, Math.round(fadeInSec * sampleRate));
  const fo = Math.min(data.length, Math.round(fadeOutSec * sampleRate));
  for (let i = 0; i < fi; i++) data[i] *= i / fi;
  for (let i = 0; i < fo; i++) data[data.length - 1 - i] *= i / fo;
}

/** Removes DC offset and normalises to `target` peak. Mutates in place. */
export function normalize(data: Float32Array, target = 0.98): void {
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length || 1;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    data[i] -= mean;
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
  }
  if (peak > 1e-6) {
    const g = target / peak;
    for (let i = 0; i < data.length; i++) data[i] *= g;
  }
}

export interface PeakEnvelope {
  /** Interleaved min/max pairs, one pair per bucket. */
  data: Float32Array;
  buckets: number;
}

/**
 * Builds a min/max envelope for waveform painting. One bucket per pixel keeps
 * timeline rendering O(width) regardless of clip length or zoom level.
 */
export function peakEnvelope(channel: Float32Array, buckets: number): PeakEnvelope {
  const n = Math.max(1, Math.min(buckets, channel.length));
  const data = new Float32Array(n * 2);
  const per = channel.length / n;
  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(channel.length, Math.max(start + 1, Math.floor((b + 1) * per)));
    let mn = 1;
    let mx = -1;
    for (let i = start; i < end; i++) {
      const v = channel[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    data[b * 2] = mn;
    data[b * 2 + 1] = mx;
  }
  return { data, buckets: n };
}

/** RMS level in dBFS, used for clip gain readouts. */
export function rmsDb(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / (data.length || 1));
  return 20 * Math.log10(Math.max(1e-7, rms));
}

export function peakDb(data: Float32Array): number {
  let p = 0;
  for (let i = 0; i < data.length; i++) p = Math.max(p, Math.abs(data[i]));
  return 20 * Math.log10(Math.max(1e-7, p));
}

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const gainToDb = (g: number) => 20 * Math.log10(Math.max(1e-7, g));

/** Frequency <-> note conversion (A4 = 440 Hz, MIDI 69). */
export const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
export const freqToMidi = (freq: number) => 69 + 12 * Math.log2(Math.max(1e-6, freq) / 440);

const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const midiName = (midi: number) => `${PC[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
export const pitchClassName = (pc: number) => PC[((pc % 12) + 12) % 12];
export const PC_NAMES = PC;

/** Chord qualities used by the pitch trainer. */
export type ChordQuality =
  | 'maj'
  | 'min'
  | 'dim'
  | 'aug'
  | 'sus4'
  | 'sus2'
  | 'maj7'
  | 'min7'
  | 'dom7'
  | 'min7b5'
  | 'six'
  | 'min6'
  | 'add9'
  | 'power'
  | 'fifth'
  | 'octave'
  | 'maj9'
  | 'dom9'
  | 'min9'
  | 'six9'
  | 'ninesus4'
  | 'min7add11';

export const CHORD_INTERVALS: Record<ChordQuality, number[]> = {
  /* ── Two voices ──────────────────────────────────────────────────────────
     Without these the picker's "2" was permanently unreachable: every other
     quality has three or more voices. */
  fifth: [0, 7],
  octave: [0, 12],
  /* ── Three voices ────────────────────────────────────────────────────── */
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  power: [0, 7, 12],
  /* ── Four voices ─────────────────────────────────────────────────────── */
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  min7b5: [0, 3, 6, 10],
  six: [0, 4, 7, 9],
  min6: [0, 3, 7, 9],
  add9: [0, 4, 7, 14],
  /* ── Five voices ─────────────────────────────────────────────────────────
     Likewise, nothing had five voices, so "5" could never be switched on. */
  maj9: [0, 4, 7, 11, 14],
  dom9: [0, 4, 7, 10, 14],
  min9: [0, 3, 7, 10, 14],
  six9: [0, 4, 7, 9, 14],
  ninesus4: [0, 5, 7, 10, 14],
  min7add11: [0, 3, 7, 10, 17],
};

export const CHORD_LABELS: Record<ChordQuality, string> = {
  fifth: 'Open 5th',
  octave: 'Octave',
  maj: 'Major',
  min: 'Minor',
  dim: 'Dim',
  aug: 'Aug',
  sus4: 'Sus4',
  sus2: 'Sus2',
  power: '5',
  maj7: 'Maj7',
  min7: 'Min7',
  dom7: 'Dom7',
  min7b5: 'm7♭5',
  six: '6',
  min6: 'm6',
  add9: 'Add9',
  maj9: 'Maj9',
  dom9: 'Dom9',
  min9: 'Min9',
  six9: '6/9',
  ninesus4: '9sus4',
  min7add11: 'm11',
};

export function chordNotes(rootMidi: number, quality: ChordQuality): number[] {
  return CHORD_INTERVALS[quality].map((i) => rootMidi + i);
}

export function chordName(rootMidi: number, quality: ChordQuality): string {
  const root = PC[((rootMidi % 12) + 12) % 12];
  const short: Record<ChordQuality, string> = {
    fifth: '5',
    octave: '8ve',
    maj: '',
    min: 'm',
    dim: 'dim',
    aug: 'aug',
    sus4: 'sus4',
    sus2: 'sus2',
    maj7: 'maj7',
    min7: 'm7',
    dom7: '7',
    min7b5: 'm7♭5',
    six: '6',
    min6: 'm6',
    add9: 'add9',
    power: '5',
    maj9: 'maj9',
    dom9: '9',
    min9: 'm9',
    six9: '6/9',
    ninesus4: '9sus4',
    min7add11: 'm11',
  };
  return `${root}${short[quality]}`;
}

/** Scale definitions — semitone offsets from the tonic. */
export const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  majorPent: [0, 2, 4, 7, 9],
  minorPent: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
} as const;

export type ScaleName = keyof typeof SCALES;
