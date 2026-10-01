/* ============================================================================
   LiteDAW · METRONOME
   Lookahead scheduler on the Web Audio clock. Emits beat events with their
   exact context time so the UI can animate in perfect sync, and exposes
   phase queries for the beat visualiser.
   ========================================================================= */

import { engine } from './engine';

export type ClickSound = 'beep' | 'wood' | 'rim' | 'tick' | 'sub';

export interface MetronomeConfig {
  bpm: number;
  /** Beats per bar (time-signature numerator). */
  beatsPerBar: number;
  /** Note value that gets the beat (denominator): 4 = quarter, 8 = eighth. */
  beatUnit: number;
  /** Sub-clicks per beat: 1 = none, 2 = eighths, 3 = triplets, 4 = sixteenths. */
  subdivision: number;
  /** Accent pattern, one entry per beat. */
  accents: boolean[];
  sound: ClickSound;
  /** 0..1 */
  level: number;
  /** Mute every beat except the downbeat. */
  downbeatOnly: boolean;
}

export interface BeatEvent {
  /** Absolute AudioContext time of the click. */
  time: number;
  /** Beat index inside the bar. */
  beat: number;
  /** Bar counter since start. */
  bar: number;
  /** Subdivision index inside the beat (0 = the beat itself). */
  sub: number;
  accent: boolean;
}

export const DEFAULT_METRONOME: MetronomeConfig = {
  bpm: 120,
  beatsPerBar: 4,
  beatUnit: 4,
  subdivision: 1,
  accents: [true, false, false, false],
  sound: 'beep',
  level: 0.7,
  downbeatOnly: false,
};

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.16;

export class Metronome {
  cfg: MetronomeConfig = { ...DEFAULT_METRONOME };
  private timer: number | null = null;
  private nextTime = 0;
  private beat = 0;
  private bar = 0;
  private sub = 0;
  /** Beat events still in the future, for reactive UI. */
  private queue: BeatEvent[] = [];
  /** Events already played, so a polling UI can catch up. */
  private history: BeatEvent[] = [];
  private startedAt = 0;

  /** Fired (synchronously, ahead of time) whenever a click is scheduled. */
  onSchedule: ((e: BeatEvent) => void) | null = null;

  get running() {
    return this.timer !== null;
  }

  start(at?: number) {
    void engine.init().then((ctx) => {
      if (this.running) return;
      this.beat = 0;
      this.bar = 0;
      this.sub = 0;
      this.queue = [];
      this.history = [];
      this.nextTime = at ?? ctx.currentTime + 0.08;
      this.startedAt = this.nextTime;
      this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS);
      this.tick();
    });
  }

  stop() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick() {
    const ctx = engine.ctx;
    if (!ctx) return;
    while (this.nextTime < ctx.currentTime + SCHEDULE_AHEAD) {
      this.scheduleClick(this.nextTime);
      this.advance();
    }
    // prune history older than a second
    const cutoff = ctx.currentTime - 1;
    while (this.history.length && this.history[0].time < cutoff) this.history.shift();
  }

  private advance() {
    const c = this.cfg;
    const beatDur = 60 / Math.max(1, c.bpm) * (4 / Math.max(1, c.beatUnit));
    this.nextTime += beatDur / Math.max(1, c.subdivision);
    this.sub += 1;
    if (this.sub >= Math.max(1, c.subdivision)) {
      this.sub = 0;
      this.beat += 1;
      if (this.beat >= Math.max(1, c.beatsPerBar)) {
        this.beat = 0;
        this.bar += 1;
      }
    }
  }

  private scheduleClick(time: number) {
    const ctx = engine.ctx;
    if (!ctx) return;
    const c = this.cfg;
    const accent = this.sub === 0 && (c.accents[this.beat] ?? this.beat === 0);
    // In downbeat-only mode the grid keeps running (so the visualiser and any
    // answer comparison stay aligned) but only bar 1 produces sound.
    const silent = c.downbeatOnly && !(this.sub === 0 && this.beat === 0);
    if (!silent) this.click(time, accent, this.sub === 0);

    const ev: BeatEvent = { time, beat: this.beat, bar: this.bar, sub: this.sub, accent };
    this.queue.push(ev);
    this.history.push(ev);
    this.onSchedule?.(ev);
  }

  private click(time: number, accent: boolean, onBeat: boolean) {
    const ctx = engine.ctx;
    if (!ctx) return;
    const dest = engine.bus('bpm');
    const c = this.cfg;
    const gain = ctx.createGain();
    const v = c.level * (accent ? 1 : onBeat ? 0.72 : 0.42);
    gain.gain.value = v;
    gain.connect(dest);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.connect(gain);

    const o = ctx.createOscillator();
    o.connect(bp);

    let dur = 0.05;
    switch (c.sound) {
      case 'wood':
        o.type = 'triangle';
        o.frequency.setValueAtTime(accent ? 1300 : 940, time);
        o.frequency.exponentialRampToValueAtTime(accent ? 620 : 460, time + 0.035);
        bp.frequency.value = 1500;
        bp.Q.value = 2.2;
        dur = 0.06;
        break;
      case 'rim':
        o.type = 'square';
        o.frequency.setValueAtTime(accent ? 2600 : 1900, time);
        bp.frequency.value = 3200;
        bp.Q.value = 3.4;
        dur = 0.028;
        break;
      case 'tick':
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(accent ? 3200 : 2400, time);
        bp.frequency.value = 4200;
        bp.Q.value = 4;
        dur = 0.016;
        break;
      case 'sub':
        o.type = 'sine';
        o.frequency.setValueAtTime(accent ? 180 : 120, time);
        o.frequency.exponentialRampToValueAtTime(58, time + 0.09);
        bp.type = 'lowpass';
        bp.frequency.value = 420;
        dur = 0.12;
        break;
      case 'beep':
      default:
        o.type = 'square';
        o.frequency.setValueAtTime(accent ? 1760 : 1174, time);
        bp.frequency.value = accent ? 2200 : 1600;
        bp.Q.value = 1.2;
        dur = 0.045;
        break;
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(1, time + 0.0016);
    env.gain.exponentialRampToValueAtTime(1e-4, time + dur);
    bp.disconnect();
    bp.connect(env);
    env.connect(gain);

    o.start(time);
    o.stop(time + dur + 0.02);
    o.onended = () => {
      try {
        env.disconnect();
        bp.disconnect();
        gain.disconnect();
      } catch {
        /* noop */
      }
    };
  }

  /** Consumes beat events whose time has arrived. Call from a RAF loop. */
  drain(now: number): BeatEvent[] {
    const out: BeatEvent[] = [];
    while (this.queue.length && this.queue[0].time <= now + 0.008) out.push(this.queue.shift()!);
    return out;
  }

  /** Continuous position for the visualiser: fractional beats since start. */
  position(): { beats: number; beat: number; bar: number; phase: number } {
    const ctx = engine.ctx;
    const c = this.cfg;
    if (!ctx || !this.running) return { beats: 0, beat: 0, bar: 0, phase: 0 };
    const beatDur = (60 / Math.max(1, c.bpm)) * (4 / Math.max(1, c.beatUnit));
    const total = (ctx.currentTime - this.startedAt) / beatDur;
    if (total < 0) return { beats: 0, beat: 0, bar: 0, phase: 0 };
    const bar = Math.floor(total / c.beatsPerBar);
    const inBar = total % c.beatsPerBar;
    return { beats: total, beat: Math.floor(inBar), bar, phase: inBar % 1 };
  }

  setBpm(bpm: number) {
    this.cfg.bpm = Math.max(20, Math.min(400, bpm));
  }

  setLevel(v: number) {
    this.cfg.level = Math.max(0, Math.min(1, v));
  }
}

export const metronome = new Metronome();
