/* ============================================================================
   LiteDAW · PITCH PAGE — question playback scheduler
   Plays a question as a block chord or an arpeggio, repeats it `cfg.replays`
   times, and reports the live pass index so the panel can say
   "PLAYING · REPLAY 2/3". Every voice is scheduled ahead of time on the audio
   clock (sample-accurate) while the visible state rides cheap timers, so a
   cancel can silence the whole thing instantly.
   ========================================================================= */

import { engine } from '../../audio/engine';
import { playNote, type InstrumentId } from '../../audio/synth';
import { playSample, samples } from '../../audio/sampler';
import type { PitchConfig, Question } from '../../state/pitch';

/** Arpeggio note spacing, seconds. */
export const ARP_STAGGER = 0.09;
/** Block chord: a hair of spread so the attack does not sum into a click. */
const BLOCK_STAGGER = 0.012;
/** Silence between repeats. */
const PASS_GAP = 0.55;
/** Lead-in before the first note. */
const LEAD_IN = 0.09;
/** How long a single auditioned key rings. */
export const AUDITION_SECONDS = 1.5;

export interface PlayCallbacks {
  /** Fired at the start of every pass (1-based). */
  onPass?: (pass: number, passes: number) => void;
  /** Fired once the last scheduled voice has finished (never on cancel). */
  onDone?: () => void;
}

export interface PlaybackInfo {
  questionId: number;
  pass: number;
  passes: number;
}

/**
 * Deterministic per-question, per-note detune in cents. Same question → same
 * detune, so the A/B replay is a true comparison, while a fresh question is
 * always a little out of tune for absolute-pitch cheaters.
 */
export function detuneFor(questionId: number, index: number, jitter: number): number {
  if (jitter <= 0) return 0;
  const x = Math.sin((questionId * 97 + index * 31 + 7) * 12.9898) * 43758.5453;
  const r = x - Math.floor(x);
  return (r * 2 - 1) * jitter;
}

/** Total wall-clock length of one question, in seconds. */
export function questionDuration(cfg: PitchConfig, noteCount: number): number {
  const stagger = cfg.playStyle === 'arpeggio' ? ARP_STAGGER : BLOCK_STAGGER;
  const passLen = Math.max(0, noteCount - 1) * stagger + Math.max(0.25, cfg.sustain);
  const passes = 1 + Math.max(0, Math.round(cfg.replays));
  return LEAD_IN + passes * (passLen + PASS_GAP);
}

type StopFn = (when?: number) => void;

export class QuestionScheduler {
  private timers: number[] = [];
  private stops: StopFn[] = [];
  private run = 0;

  /** Silences everything scheduled so far. Safe to call at any time. */
  cancel() {
    this.run += 1;
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers = [];
    const at = (engine.ctx?.currentTime ?? 0) + 0.02;
    this.stops.forEach((stop) => {
      try {
        stop(at);
      } catch {
        /* already released */
      }
    });
    this.stops = [];
  }

  private at(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, Math.max(0, ms)));
  }

  /**
   * Schedules one full question. Resolves `true` when the playback actually
   * started, `false` when it was superseded before the context was ready.
   */
  async play(q: Question, cfg: PitchConfig, cb: PlayCallbacks = {}): Promise<boolean> {
    this.cancel();
    const my = this.run;

    const ctx = await engine.init();
    if (my !== this.run) return false;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    if (my !== this.run) return false;

    const dest = engine.bus('pitch');
    const notes = [...q.midis].sort((a, b) => a - b);
    if (!notes.length) {
      this.at(0, () => cb.onDone?.());
      return true;
    }

    const entry = q.instrument === 'sample' ? samples.get(q.sampleId) : null;
    const instrument: InstrumentId = q.instrument === 'sample' ? 'piano' : q.instrument;
    const style = cfg.playStyle;
    const stagger = style === 'arpeggio' ? ARP_STAGGER : BLOCK_STAGGER;
    const dur = Math.max(0.25, cfg.sustain);
    const velocity = style === 'arpeggio' ? 0.7 : 0.66;
    const passLen = (notes.length - 1) * stagger + dur;
    const period = passLen + PASS_GAP;
    const passes = 1 + Math.max(0, Math.round(cfg.replays));
    const t0 = ctx.currentTime + LEAD_IN;

    for (let p = 0; p < passes; p++) {
      const base = t0 + p * period;
      notes.forEach((midi, i) => {
        const when = base + i * stagger;
        const detune = detuneFor(q.id, i, cfg.detuneJitter);
        if (entry) {
          const h = playSample(ctx, dest, entry, {
            midi,
            when,
            duration: dur,
            velocity: 0.82,
            detuneCents: detune,
          });
          this.stops.push(h.stop);
        } else {
          const h = playNote(
            ctx,
            dest,
            { midi, when, duration: dur, velocity, instrument },
            { detune },
          );
          this.stops.push(h.stop);
        }
      });
      this.at((base - ctx.currentTime) * 1000, () => {
        if (my === this.run) cb.onPass?.(p + 1, passes);
      });
    }

    this.at((t0 + passes * period - ctx.currentTime) * 1000, () => {
      if (my !== this.run) return;
      this.stops = [];
      cb.onDone?.();
    });
    return true;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   AUDITION — one key, held while the finger is down
   ══════════════════════════════════════════════════════════════════════════ */

export class Auditioner {
  private ctx: BaseAudioContext | null = null;
  private dest: AudioNode | null = null;
  private live = new Map<number, StopFn>();
  private previewMidi: number | null = null;

  private async ready(): Promise<{ ctx: BaseAudioContext; dest: AudioNode }> {
    const ctx = await engine.init();
    this.ctx = ctx;
    this.dest = engine.bus('pitch');
    return { ctx, dest: this.dest };
  }

  /** Press: sounds `midi` and holds it until `release` (or `holdMs`). */
  async press(midi: number, instrument: InstrumentId, holdMs?: number) {
    const { ctx, dest } = await this.ready();
    this.release(midi, 0.02);
    const h = playNote(
      ctx,
      dest,
      { midi, when: ctx.currentTime + 0.008, duration: AUDITION_SECONDS, velocity: 0.66, instrument },
      {},
    );
    this.live.set(midi, h.stop);
    if (holdMs !== undefined) {
      window.setTimeout(() => this.release(midi, 0.09), holdMs);
    }
  }

  release(midi: number, fade = 0.12) {
    const stop = this.live.get(midi);
    if (!stop) return;
    this.live.delete(midi);
    try {
      stop((this.ctx?.currentTime ?? 0) + fade);
    } catch {
      /* already gone */
    }
  }

  /** Dial scrub: one note at a time, replaced as the head sweeps the ring. */
  async preview(midi: number, instrument: InstrumentId) {
    if (this.previewMidi !== null && this.previewMidi !== midi) {
      this.release(this.previewMidi, 0.05);
    }
    this.previewMidi = midi;
    await this.press(midi, instrument, 900);
  }

  stopAll() {
    this.live.forEach((stop) => {
      try {
        stop((this.ctx?.currentTime ?? 0) + 0.04);
      } catch {
        /* already gone */
      }
    });
    this.live.clear();
    this.previewMidi = null;
  }
}

/** Plain one-shot used for reference beeps (correct/wrong annunciation). */
export async function blip(midi: number, instrument: InstrumentId, seconds = 0.22, velocity = 0.5) {
  const ctx = await engine.init();
  playNote(
    ctx,
    engine.bus('pitch'),
    { midi, when: ctx.currentTime + 0.01, duration: seconds, velocity, instrument },
    {},
  );
}
