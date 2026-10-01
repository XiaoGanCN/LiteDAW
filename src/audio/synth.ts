/* ============================================================================
   LiteDAW · SYNTH VOICES
   Allocation-free, Web-Audio-native note generators. Each voice is a small
   additive/FM/subtractive model rather than a sampler, so it starts instantly
   and needs no downloads.
   ========================================================================= */

import { midiToFreq } from './dsp';

export type InstrumentId =
  | 'piano'
  | 'epiano'
  | 'bell'
  | 'marimba'
  | 'pluck'
  | 'organ'
  | 'strings'
  | 'pad'
  | 'bass'
  | 'sub'
  | 'sine'
  | 'triangle'
  | 'saw'
  | 'square'
  | 'click';

export interface InstrumentMeta {
  id: InstrumentId;
  label: string;
  family: 'Keys' | 'Tonal' | 'Wave' | 'Percussive';
  /** Rough timbre descriptor shown in the picker. */
  character: string;
}

export const INSTRUMENTS: InstrumentMeta[] = [
  { id: 'piano', label: 'Piano', family: 'Keys', character: 'additive · bright attack' },
  { id: 'epiano', label: 'E.Piano', family: 'Keys', character: 'FM · tine bell' },
  { id: 'bell', label: 'Bell', family: 'Keys', character: 'FM · long tail' },
  { id: 'marimba', label: 'Marimba', family: 'Keys', character: 'sine · wooden' },
  { id: 'organ', label: 'Organ', family: 'Tonal', character: 'drawbar · steady' },
  { id: 'strings', label: 'Strings', family: 'Tonal', character: 'saw ensemble · slow' },
  { id: 'pad', label: 'Pad', family: 'Tonal', character: 'detuned · filtered' },
  { id: 'pluck', label: 'Pluck', family: 'Percussive', character: 'saw · fast decay' },
  { id: 'bass', label: 'Bass', family: 'Tonal', character: 'saturated · fundamental' },
  { id: 'sub', label: 'Sub', family: 'Tonal', character: 'sine · deep' },
  { id: 'sine', label: 'Sine', family: 'Wave', character: 'pure tone' },
  { id: 'triangle', label: 'Triangle', family: 'Wave', character: 'soft odd harmonics' },
  { id: 'saw', label: 'Saw', family: 'Wave', character: 'full harmonic series' },
  { id: 'square', label: 'Square', family: 'Wave', character: 'hollow odd harmonics' },
  { id: 'click', label: 'Click', family: 'Percussive', character: 'transient · reference' },
];

export interface NoteEvent {
  midi: number;
  /** AudioContext time to start at. */
  when: number;
  /** Seconds. Ignored for sustained voices that are stopped manually. */
  duration: number;
  velocity?: number;
  instrument: InstrumentId;
}

export interface VoiceHandle {
  stop: (when?: number) => void;
  /** Absolute AudioContext time the voice ends on its own, if it does. */
  endsAt: number;
}

const TWO_PI = Math.PI * 2;

function noiseBuffer(ctx: BaseAudioContext, seconds = 0.4) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.03 * white) / 1.03;
    d[i] = white * 0.7 + last * 3.2;
  }
  return buf;
}

let cachedNoise: WeakMap<BaseAudioContext, AudioBuffer> | null = null;
function getNoise(ctx: BaseAudioContext) {
  cachedNoise ??= new WeakMap();
  let b = cachedNoise.get(ctx);
  if (!b) {
    b = noiseBuffer(ctx);
    cachedNoise.set(ctx, b);
  }
  return b;
}

/** Shared output stage: keeps voices from ever clipping the bus. */
function voiceOut(ctx: BaseAudioContext, dest: AudioNode, gain: number) {
  const g = ctx.createGain();
  g.gain.value = gain;
  g.connect(dest);
  return g;
}

/**
 * Renders a single note. Returns a handle whose `stop()` can shorten or extend
 * a sustained voice. Natural-decay voices report their own `endsAt`.
 */
export function playNote(
  ctx: BaseAudioContext,
  dest: AudioNode,
  ev: NoteEvent,
  opts: { brightness?: number; detune?: number } = {},
): VoiceHandle {
  const { midi, when, instrument } = ev;
  const vel = Math.max(0.02, Math.min(1, ev.velocity ?? 0.8));
  const f0 = midiToFreq(midi) * Math.pow(2, (opts.detune ?? 0) / 1200);
  const dur = Math.max(0.02, ev.duration);
  const bright = opts.brightness ?? 1;
  const stops: { node: AudioScheduledSourceNode; at: number }[] = [];

  switch (instrument) {
    /* ── Additive piano: inharmonic partials with per-partial decay ────── */
    case 'piano': {
      const out = voiceOut(ctx, dest, 0.26 * vel);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.min(16000, 2600 + f0 * 9 * bright);
      lp.Q.value = 0.4;
      lp.connect(out);

      const B = 0.00042; // string inharmonicity
      const amps = [1, 0.62, 0.34, 0.2, 0.12, 0.075, 0.045, 0.028, 0.018, 0.011];
      const decay = Math.max(0.35, 7.6 * Math.pow(0.5, (midi - 36) / 22));
      const held = dur;
      let last = 0;
      amps.forEach((a, i) => {
        const n = i + 1;
        const f = f0 * n * Math.sqrt(1 + B * n * n);
        if (f > ctx.sampleRate / 2.2) return;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = ctx.createGain();
        const t = decay / (1 + 0.42 * (n - 1));
        const tail = held + Math.min(1.9, t * 0.55);
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(a * 0.9, when + 0.004 + n * 0.0012);
        g.gain.exponentialRampToValueAtTime(Math.max(1e-4, a * 0.32), when + 0.09);
        g.gain.exponentialRampToValueAtTime(1e-4, when + tail);
        o.connect(g).connect(lp);
        o.start(when);
        o.stop(when + tail + 0.03);
        stops.push({ node: o, at: when + tail + 0.03 });
        last = Math.max(last, when + tail + 0.03);
      });

      // hammer transient
      const nz = ctx.createBufferSource();
      nz.buffer = getNoise(ctx);
      const nf = ctx.createBiquadFilter();
      nf.type = 'bandpass';
      nf.frequency.value = Math.min(9000, f0 * 5.5);
      nf.Q.value = 0.8;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.22 * vel, when);
      ng.gain.exponentialRampToValueAtTime(1e-4, when + 0.055);
      nz.connect(nf).connect(ng).connect(out);
      nz.start(when, 0, 0.09);
      stops.push({ node: nz, at: when + 0.09 });

      return { endsAt: last, stop: (at) => stops.forEach((s) => safeStop(s.node, at ?? when)) };
    }

    /* ── Two-operator FM: tine / bell family ──────────────────────────── */
    case 'epiano':
    case 'bell': {
      const isBell = instrument === 'bell';
      const out = voiceOut(ctx, dest, (isBell ? 0.2 : 0.24) * vel);
      const carrier = ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.value = f0;

      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.value = f0 * (isBell ? 3.51 : 2.01);

      const modGain = ctx.createGain();
      const idx = isBell ? f0 * 3.4 : f0 * 1.9;
      const mdecay = isBell ? 3.4 : 0.5;
      modGain.gain.setValueAtTime(idx, when);
      modGain.gain.exponentialRampToValueAtTime(Math.max(1, idx * 0.06), when + mdecay);
      mod.connect(modGain).connect(carrier.frequency);

      const env = ctx.createGain();
      const tail = isBell ? Math.max(1.6, dur + 3.4) : dur + Math.max(0.3, 1.5 * Math.pow(0.5, (midi - 48) / 24));
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(1, when + 0.006);
      env.gain.exponentialRampToValueAtTime(0.22, when + 0.12);
      env.gain.exponentialRampToValueAtTime(1e-4, when + tail);

      carrier.connect(env).connect(out);
      carrier.start(when);
      mod.start(when);
      carrier.stop(when + tail + 0.04);
      mod.stop(when + tail + 0.04);
      stops.push({ node: carrier, at: when + tail + 0.04 }, { node: mod, at: when + tail + 0.04 });

      return { endsAt: when + tail + 0.04, stop: (at) => stops.forEach((s) => safeStop(s.node, at ?? when)) };
    }

    /* ── Marimba: sine fundamental + tuned 4th partial ────────────────── */
    case 'marimba': {
      const out = voiceOut(ctx, dest, 0.3 * vel);
      const tail = Math.max(0.3, 2.6 * Math.pow(0.5, (midi - 48) / 26));
      [
        [1, 1, 1],
        [3.93, 0.24, 0.4],
        [9.2, 0.07, 0.22],
      ].forEach(([mult, amp, dec]) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f0 * mult;
        const g = ctx.createGain();
        const t = tail * dec;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(amp, when + 0.003);
        g.gain.exponentialRampToValueAtTime(1e-4, when + t);
        o.connect(g).connect(out);
        o.start(when);
        o.stop(when + t + 0.02);
        stops.push({ node: o, at: when + t + 0.02 });
      });
      return {
        endsAt: when + tail + 0.02,
        stop: (at) => stops.forEach((s) => safeStop(s.node, at ?? when)),
      };
    }

    /* ── Pluck: filtered saw with fast exponential decay ──────────────── */
    case 'pluck': {
      const out = voiceOut(ctx, dest, 0.24 * vel);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 6;
      const tail = Math.max(0.22, 1.9 * Math.pow(0.5, (midi - 48) / 26));
      lp.frequency.setValueAtTime(Math.min(15000, f0 * 12 + 1800), when);
      lp.frequency.exponentialRampToValueAtTime(Math.max(160, f0 * 1.4), when + tail * 0.8);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(1, when + 0.002);
      g.gain.exponentialRampToValueAtTime(1e-4, when + tail);
      o.connect(lp).connect(g).connect(out);
      o.start(when);
      o.stop(when + tail + 0.02);
      stops.push({ node: o, at: when + tail + 0.02 });
      return { endsAt: when + tail + 0.02, stop: (at) => stops.forEach((s) => safeStop(s.node, at ?? when)) };
    }

    /* ── Organ: drawbar additive, gated by duration ───────────────────── */
    case 'organ': {
      const out = voiceOut(ctx, dest, 0.15 * vel);
      const bars: [number, number][] = [
        [0.5, 0.35],
        [1, 1],
        [1.5, 0.4],
        [2, 0.5],
        [3, 0.22],
        [4, 0.24],
        [6, 0.1],
        [8, 0.13],
      ];
      bars.forEach(([mult, amp]) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f0 * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(amp, when + 0.014);
        g.gain.setValueAtTime(amp, when + Math.max(0.02, dur - 0.05));
        g.gain.linearRampToValueAtTime(0, when + dur + 0.05);
        o.connect(g).connect(out);
        o.start(when);
        o.stop(when + dur + 0.07);
        stops.push({ node: o, at: when + dur + 0.07 });
      });
      return {
        endsAt: when + dur + 0.07,
        stop: (at) => stops.forEach((s) => safeStop(s.node, at ?? when + duration(when, dur))),
      };
    }

    /* ── Strings / pad: detuned saw ensemble through a filter ─────────── */
    case 'strings':
    case 'pad': {
      const isPad = instrument === 'pad';
      const out = voiceOut(ctx, dest, (isPad ? 0.13 : 0.16) * vel);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = isPad ? 3.2 : 1.1;
      const cutoff = Math.min(12000, f0 * (isPad ? 5 : 8) * bright);
      lp.frequency.setValueAtTime(Math.max(180, f0 * 1.5), when);
      lp.frequency.linearRampToValueAtTime(cutoff, when + (isPad ? 0.7 : 0.3));
      lp.connect(out);

      const detunes = isPad ? [-11, -4, 0, 5, 12] : [-6, 0, 7];
      detunes.forEach((cents, i) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f0;
        o.detune.value = cents;
        const g = ctx.createGain();
        g.gain.value = 0.9 / detunes.length;
        const vib = ctx.createOscillator();
        vib.frequency.value = 4.6 + i * 0.7;
        const vibG = ctx.createGain();
        vibG.gain.value = 3.4;
        vib.connect(vibG).connect(o.detune);
        const env = ctx.createGain();
        const atk = isPad ? 0.34 : 0.12;
        env.gain.setValueAtTime(0, when);
        env.gain.linearRampToValueAtTime(1, when + atk);
        env.gain.setValueAtTime(1, when + Math.max(atk, dur - 0.12));
        env.gain.linearRampToValueAtTime(0, when + dur + 0.18);
        o.connect(g).connect(env).connect(lp);
        o.start(when);
        vib.start(when);
        o.stop(when + dur + 0.22);
        vib.stop(when + dur + 0.22);
        stops.push({ node: o, at: when + dur + 0.22 }, { node: vib, at: when + dur + 0.22 });
      });
      return {
        endsAt: when + dur + 0.22,
        stop: (at) => stops.forEach((s) => safeStop(s.node, at ?? when + duration(when, dur))),
      };
    }

    /* ── Bass / sub: saturated fundamental with fast release ──────────── */
    case 'bass':
    case 'sub': {
      const isBass = instrument === 'bass';
      const out = voiceOut(ctx, dest, (isBass ? 0.34 : 0.36) * vel);
      const shaper = ctx.createWaveShaper();
      if (isBass) {
        const n = 1024;
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          const x = (i / (n - 1)) * 2 - 1;
          curve[i] = Math.tanh(x * 2.2) * 0.86;
        }
        shaper.curve = curve;
      }

      const o1 = ctx.createOscillator();
      o1.type = isBass ? 'sawtooth' : 'sine';
      o1.frequency.value = f0;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f0 / 2; // sub octave
      const g2 = ctx.createGain();
      g2.gain.value = isBass ? 0.55 : 0.2;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.min(4200, f0 * 9 + 320), when);
      lp.frequency.exponentialRampToValueAtTime(Math.max(120, f0 * 2.1), when + Math.min(0.45, dur));
      lp.Q.value = 1.4;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(1, when + 0.008);
      env.gain.setValueAtTime(0.92, when + 0.06);
      env.gain.setValueAtTime(0.86, when + Math.max(0.09, dur - 0.04));
      env.gain.linearRampToValueAtTime(0, when + dur + 0.05);

      o1.connect(shaper).connect(lp);
      o2.connect(g2).connect(lp);
      lp.connect(env).connect(out);
      o1.start(when);
      o2.start(when);
      o1.stop(when + dur + 0.08);
      o2.stop(when + dur + 0.08);
      stops.push({ node: o1, at: when + dur + 0.08 }, { node: o2, at: when + dur + 0.08 });
      return {
        endsAt: when + dur + 0.08,
        stop: (at) => stops.forEach((s) => safeStop(s.node, at ?? when + duration(when, dur))),
      };
    }

    /* ── Plain waves ──────────────────────────────────────────────────── */
    case 'sine':
    case 'triangle':
    case 'saw':
    case 'square': {
      const out = voiceOut(ctx, dest, 0.22 * vel);
      const o = ctx.createOscillator();
      o.type = instrument === 'saw' ? 'sawtooth' : instrument === 'square' ? 'square' : instrument;
      o.frequency.value = f0;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(1, when + 0.008);
      env.gain.setValueAtTime(0.9, when + Math.max(0.02, dur - 0.03));
      env.gain.linearRampToValueAtTime(0, when + dur + 0.04);
      o.connect(env).connect(out);
      o.start(when);
      o.stop(when + dur + 0.06);
      stops.push({ node: o, at: when + dur + 0.06 });
      return {
        endsAt: when + dur + 0.06,
        stop: (at) => stops.forEach((s) => safeStop(s.node, at ?? when + duration(when, dur))),
      };
    }

    /* ── Click: band-limited transient for rhythm reference ───────────── */
    case 'click':
    default: {
      const out = voiceOut(ctx, dest, 0.5 * vel);
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(1760, when);
      o.frequency.exponentialRampToValueAtTime(880, when + 0.03);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2200;
      bp.Q.value = 1.4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(1, when + 0.0012);
      g.gain.exponentialRampToValueAtTime(1e-4, when + 0.05);
      o.connect(bp).connect(g).connect(out);
      o.start(when);
      o.stop(when + 0.07);
      stops.push({ node: o, at: when + 0.07 });
      return { endsAt: when + 0.07, stop: (at) => stops.forEach((s) => safeStop(s.node, at ?? when)) };
    }
  }
}

/** Distance from `when` to the scheduled end of a fixed-length voice. */
const duration = (_when: number, dur: number) => Math.max(0.01, dur);

function safeStop(node: AudioScheduledSourceNode, when: number) {
  try {
    node.stop(Math.max(0, when));
  } catch {
    /* already stopped */
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   VOICE POOL — used by interactive keyboards to avoid node churn
   ══════════════════════════════════════════════════════════════════════════ */

export class NotePlayer {
  private active = new Map<number, VoiceHandle>();

  constructor(
    private ctx: BaseAudioContext,
    private dest: AudioNode,
    private getInstrument: () => InstrumentId,
    private getBrightness: () => number = () => 1,
    private getDetune: () => number = () => 0,
  ) {}

  /** Audition: plays with a generous tail, replaced if the note repeats. */
  play(midi: number, velocity = 0.8, duration = 1.6) {
    this.stop(midi);
    const h = playNote(
      this.ctx,
      this.dest,
      { midi, when: this.ctx.currentTime + 0.012, duration, velocity, instrument: this.getInstrument() },
      { brightness: this.getBrightness(), detune: this.getDetune() },
    );
    this.active.set(midi, h);
  }

  /** Plays a full chord. */
  chord(midis: number[], velocity = 0.72, duration = 2.4) {
    const t = this.ctx.currentTime + 0.015;
    midis.forEach((m, i) => {
      playNote(
        this.ctx,
        this.dest,
        { midi: m, when: t + i * 0.035, duration, velocity, instrument: this.getInstrument() },
        { brightness: this.getBrightness(), detune: this.getDetune() },
      );
    });
  }

  stop(midi: number, when = 0.06) {
    const h = this.active.get(midi);
    if (h) {
      h.stop(this.ctx.currentTime + when);
      this.active.delete(midi);
    }
  }

  stopAll(when = 0.04) {
    this.active.forEach((h) => h.stop(this.ctx.currentTime + when));
    this.active.clear();
  }

  get held() {
    return [...this.active.keys()];
  }
}

export { TWO_PI };
