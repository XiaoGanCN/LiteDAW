/* ============================================================================
   LiteDAW · TRANSPORT ENGINE
   A lookahead scheduler on the Web Audio clock. Clip sources are created only
   a fraction of a second before they sound, which keeps memory low, makes live
   edits take effect immediately, and lets the exact same graph builder render
   the project offline for export.
   ========================================================================= */

import { dbToGain } from './dsp';
import { engine } from './engine';
import { buffers } from '../daw/buffers';
import type { Clip, DawState, Track } from '../state/daw';

export interface StripNodes {
  /** Everything routed into a track lands here. */
  input: GainNode;
  eq: BiquadFilterNode[];
  panner: StereoPannerNode;
  gain: GainNode;
}

export interface Graph {
  masterIn: GainNode;
  strips: Map<string, StripNodes>;
}

export interface GraphOptions {
  masterGain?: number;
  /**
   * Where the project master lands. Realtime playback MUST pass
   * `engine.bus('daw')` so the mix joins the shared master chain — that is what
   * the Instruments deck, the transport OUT meter, the master analyser and the
   * limiter all tap. Connecting straight to `ctx.destination` instead (the
   * original behaviour) silently bypassed all of them, which is why every scope
   * read flat while the Studio was playing. Offline rendering passes the
   * OfflineAudioContext's own destination, which lives in a different graph.
   */
  output?: AudioNode;
}

/** Builds the mixer topology shared by realtime playback and offline render. */
export function buildGraph(ctx: BaseAudioContext, state: DawState, opts: GraphOptions = {}): Graph {
  const masterIn = ctx.createGain();
  masterIn.gain.value = opts.masterGain ?? state.masterVolume;
  const sink = opts.output ?? engine.bus('daw');
  masterIn.connect(sink);

  const strips = new Map<string, StripNodes>();
  const anySolo = state.tracks.some((t) => t.solo);

  state.tracks.forEach((t) => {
    const input = ctx.createGain();
    const eq = t.eq.map((band) => {
      const f = ctx.createBiquadFilter();
      f.type = band.type;
      f.frequency.value = band.freq;
      f.Q.value = band.q;
      f.gain.value = t.eqOn && band.on ? band.gain : 0;
      return f;
    });
    const panner = ctx.createStereoPanner();
    panner.pan.value = t.pan;
    const gain = ctx.createGain();
    const audible = anySolo ? t.solo : !t.mute;
    gain.gain.value = audible ? t.volume : 0;

    let node: AudioNode = input;
    eq.forEach((f) => {
      node.connect(f);
      node = f;
    });
    node.connect(panner);
    panner.connect(gain);
    gain.connect(masterIn);

    strips.set(t.id, { input, eq, panner, gain });
  });

  return { masterIn, strips };
}

/** Applies live parameter changes without rebuilding the graph. */
export function syncGraph(graph: Graph, state: DawState, ctx: BaseAudioContext) {
  const anySolo = state.tracks.some((t) => t.solo);
  const t0 = ctx.currentTime;
  const ramp = 0.02;
  state.tracks.forEach((t) => {
    const s = graph.strips.get(t.id);
    if (!s) return;
    const audible = anySolo ? t.solo : !t.mute;
    s.gain.gain.setTargetAtTime(audible ? t.volume : 0, t0, ramp);
    s.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, t.pan)), t0, ramp);
    t.eq.forEach((band, i) => {
      const f = s.eq[i];
      if (!f) return;
      if (Math.abs(f.frequency.value - band.freq) > 0.5) f.frequency.setTargetAtTime(band.freq, t0, 0.01);
      const g = t.eqOn && band.on ? band.gain : 0;
      if (Math.abs(f.gain.value - g) > 0.01) f.gain.setTargetAtTime(g, t0, 0.01);
      if (Math.abs(f.Q.value - band.q) > 0.001) f.Q.setTargetAtTime(band.q, t0, 0.01);
    });
  });
  graph.masterIn.gain.setTargetAtTime(state.masterVolume, t0, ramp);
}

/* ══════════════════════════════════════════════════════════════════════════
   SCHEDULER
   ══════════════════════════════════════════════════════════════════════════ */

const TICK_MS = 30;
const LOOKAHEAD = 0.35;

interface Live {
  src: AudioBufferSourceNode;
  gain: GainNode;
  clipId: string;
  startAt: number;
  endsAt: number;
}

export class DawTransport {
  private graph: Graph | null = null;
  private live: Live[] = [];
  private timer: number | null = null;
  /** ctx-time (seconds) that corresponds to project time `startPos`. */
  private originCtxTime = 0;
  private startPos = 0;
  /** Project time already handed to the scheduler. */
  private schedPos = 0;
  private state: DawState | null = null;
  /** Bumped whenever clips are edited so windows already scheduled are redone. */
  private revision = 0;

  /** Fires each time the loop wraps, for UI counters. */
  onWrap: (() => void) | null = null;

  get playing() {
    return this.timer !== null;
  }

  getGraph() {
    return this.graph;
  }

  /** Project-time ↔ context-time mapping for the current playback run. */
  private ctxTimeOf(projectSec: number) {
    return this.originCtxTime + (projectSec - this.startPos);
  }

  /** Current position in project seconds, loop-aware. */
  position(): number {
    const ctx = engine.ctx;
    const s = this.state;
    if (!ctx || !s) return this.startPos;
    if (!this.playing) return s.position;
    let pos = this.startPos + (ctx.currentTime - this.originCtxTime);
    if (s.loopOn && s.loopEnd > s.loopStart) {
      const len = s.loopEnd - s.loopStart;
      if (pos >= s.loopEnd) pos = s.loopStart + ((pos - s.loopStart) % len);
    }
    return Math.max(0, pos);
  }

  async start(state: DawState, from: number) {
    const ctx = await engine.init();
    // Tear the previous run down completely — otherwise each restart would
    // leave an orphaned graph connected to the destination.
    this.stop();
    this.state = state;
    this.graph = buildGraph(ctx, state);
    state.tracks.forEach((t) => {
      const strip = this.graph?.strips.get(t.id);
      if (strip) engine.createTap(`track:${t.id}`, strip.gain, 512);
    });
    this.originCtxTime = ctx.currentTime + 0.07;
    this.startPos = from;
    this.schedPos = from;
    this.revision = 0;
    if (this.timer === null) this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.stopSources();
    this.state?.tracks.forEach((t) => engine.releaseTap(`track:${t.id}`));
    this.graph = null;
  }

  private stopSources() {
    this.live.forEach((l) => {
      try {
        l.src.onended = null;
        l.src.stop();
      } catch {
        /* already finished */
      }
      try {
        l.gain.disconnect();
      } catch {
        /* noop */
      }
    });
    this.live = [];
  }

  /**
   * Re-anchors playback at a new project position WITHOUT rebuilding the graph.
   *
   * Repositioning used to go through `start()`, which tears the graph down and
   * rebuilds it — far too heavy to run on every pointer move while the user
   * drags the playhead during playback. This drops the sources that have not
   * sounded yet and re-maps project time onto the audio clock, so the
   * scheduler refills from the new position on its next tick.
   */
  seek(projectSec: number) {
    const ctx = engine.ctx;
    if (!ctx || !this.playing) return;
    const now = ctx.currentTime;
    const keep: Live[] = [];
    this.live.forEach((l) => {
      if (l.startAt > now + 0.02) {
        try {
          l.src.onended = null;
          l.src.stop();
          l.gain.disconnect();
        } catch {
          /* already finished */
        }
      } else keep.push(l);
    });
    this.live = keep;
    this.originCtxTime = now + 0.03;
    this.startPos = Math.max(0, projectSec);
    this.schedPos = Math.max(0, projectSec);
  }

  /**
   * Pushes a fresh project snapshot. Graph parameters are applied instantly;
   * `reschedule` additionally drops clips that have not started sounding yet so
   * edits to their position or content take effect on the next window.
   */
  update(state: DawState, opts: { reschedule?: boolean } = {}) {
    this.state = state;
    if (this.graph && engine.ctx) syncGraph(this.graph, state, engine.ctx);
    if (opts.reschedule) {
      this.revision++;
      if (this.playing) {
        const ctx = engine.ctx!;
        const now = ctx.currentTime;
        const keep: Live[] = [];
        this.live.forEach((l) => {
          if (l.startAt > now + 0.02) {
            try {
              l.src.onended = null;
              l.src.stop();
              l.gain.disconnect();
            } catch {
              /* noop */
            }
          } else keep.push(l);
        });
        this.live = keep;
        // Re-open the scheduling window from the audible position onwards.
        this.schedPos = Math.max(this.position() + 0.02, this.schedPos - LOOKAHEAD);
      }
    }
  }

  /** Auditions one clip through its own track strip. */
  async audition(clip: Clip, track: Track | undefined) {
    const ctx = await engine.init();
    const state = this.state;
    if (!state) return;
    const graph = this.graph ?? buildGraph(ctx, state);
    const strip = graph.strips.get(clip.trackId);
    if (!strip) return;
    const rec = buffers.get(clip.bufferId);
    if (!rec) return;
    const rate = Math.max(0.05, clip.speed * (track?.speed ?? 1));
    const buffer = buffers.pitched(clip.bufferId, clip.pitch + (track?.pitch ?? 0)) ?? rec.buffer;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = dbToGain(clip.gainDb);
    src.connect(g).connect(strip.input);
    src.start(ctx.currentTime + 0.02, clip.offset, Math.min(clip.duration * rate, buffer.duration - clip.offset));
  }

  private tick() {
    const ctx = engine.ctx;
    const s = this.state;
    if (!ctx || !s) return;

    const horizon = ctx.currentTime + LOOKAHEAD;
    const looping = s.loopOn && s.loopEnd > s.loopStart;

    /* If the scheduler has fallen past the end of the loop — because the user
       seeked beyond it, dragged the loop end in front of the playhead, or
       enabled a loop behind the playhead — jump straight back inside it. Doing
       this BEFORE any time arithmetic is what keeps the project↔context mapping
       from inverting, which previously produced huge negative AudioParam times
       ("Time must be a finite non-negative number: -172.393"). */
    if (looping && this.schedPos >= s.loopEnd) {
      this.originCtxTime = ctx.currentTime + 0.02;
      this.startPos = s.loopStart;
      this.schedPos = s.loopStart;
      this.onWrap?.();
    }

    let guard = 0;
    while (this.ctxTimeOf(this.schedPos) < horizon && guard++ < 512) {
      const windowEnd = looping ? Math.min(this.schedPos + LOOKAHEAD, s.loopEnd) : this.schedPos + LOOKAHEAD;
      this.scheduleWindow(s, this.schedPos, windowEnd);

      if (looping && windowEnd >= s.loopEnd) {
        /* Realign the mapping so the loop is seamless in the audio clock. The
           wrap instant can never be in the past, so clamp it: a negative
           origin would poison every subsequent schedule. */
        const wrapCtxTime = Math.max(this.ctxTimeOf(s.loopEnd), ctx.currentTime + 0.005);
        this.originCtxTime = wrapCtxTime;
        this.startPos = s.loopStart;
        this.schedPos = s.loopStart;
        this.onWrap?.();
      } else {
        this.schedPos = windowEnd;
      }
    }

    this.live = this.live.filter((l) => l.endsAt > ctx.currentTime);
  }

  private scheduleWindow(s: DawState, from: number, to: number) {
    if (!this.graph) return;
    const ctx = engine.ctx!;
    s.clips.forEach((clip) => {
      if (clip.muted) return;
      const clipEnd = clip.start + clip.duration;
      if (clipEnd <= from || clip.start >= to) return;
      const strip = this.graph!.strips.get(clip.trackId);
      if (!strip) return;
      const winStart = Math.max(clip.start, from);
      const winEnd = Math.min(clipEnd, to);
      if (winEnd - winStart < 0.0015) return;
      this.scheduleClip(ctx, strip, clip, s.tracks.find((t) => t.id === clip.trackId), winStart, winEnd);
    });
  }

  private scheduleClip(
    ctx: AudioContext,
    strip: StripNodes,
    clip: Clip,
    track: Track | undefined,
    winStart: number,
    winEnd: number,
  ) {
    const rec = buffers.get(clip.bufferId);
    if (!rec) return;
    const pitch = clip.pitch + (track?.pitch ?? 0);
    const rate = Math.max(0.05, clip.speed * (track?.speed ?? 1));
    const buffer = buffers.pitched(clip.bufferId, pitch, 78, 4, ctx.sampleRate) ?? rec.buffer;

    const srcOffset = clip.offset + (winStart - clip.start) * rate;
    if (srcOffset >= buffer.duration) return;
    const srcDur = Math.min((winEnd - winStart) * rate, Math.max(0, buffer.duration - srcOffset));
    if (srcDur <= 0) return;

    const when = Math.max(0, this.ctxTimeOf(winStart));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;

    const g = ctx.createGain();
    const clipGain = dbToGain(clip.gainDb);
    const env = (t: number) => {
      let v = clipGain;
      if (clip.fadeIn > 0 && t < clip.fadeIn) v *= Math.max(0, t / clip.fadeIn);
      const tail = clip.duration - t;
      if (clip.fadeOut > 0 && tail < clip.fadeOut) v *= Math.max(0, tail / clip.fadeOut);
      return Math.max(0, Math.min(2, v));
    };
    const localStart = winStart - clip.start;
    const span = winEnd - winStart;
    g.gain.setValueAtTime(env(localStart), when);
    const steps = Math.max(1, Math.ceil(span * 30));
    for (let i = 1; i <= steps; i++) {
      const t = localStart + span * (i / steps);
      g.gain.linearRampToValueAtTime(env(t), when + span * (i / steps));
    }

    src.connect(g).connect(strip.input);
    src.start(when, srcOffset, srcDur);
    this.live.push({ src, gain: g, clipId: clip.id, startAt: when, endsAt: when + span + 0.03 });
    src.onended = () => {
      try {
        g.disconnect();
      } catch {
        /* noop */
      }
    };
  }
}

export const transport = new DawTransport();

/* ══════════════════════════════════════════════════════════════════════════
   OFFLINE RENDER
   ══════════════════════════════════════════════════════════════════════════ */

export interface RenderOptions {
  sampleRate: number;
  channels: 1 | 2;
  /** Extra seconds appended for reverb/release tails. */
  tail?: number;
  /** Render only between these project seconds (defaults to the whole project). */
  range?: { start: number; end: number };
  onProgress?: (ratio: number) => void;
}

/** Renders the whole project through the same graph used for playback. */
export async function renderProject(state: DawState, opts: RenderOptions): Promise<AudioBuffer> {
  const start = opts.range?.start ?? 0;
  const end = opts.range?.end ?? Math.max(1, state.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0));
  const tail = opts.tail ?? 0.35;
  const duration = Math.max(0.25, end - start + tail);
  const OAC: typeof OfflineAudioContext =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new OAC(opts.channels, Math.ceil(duration * opts.sampleRate), opts.sampleRate);

  const graph = buildGraph(ctx, state, { masterGain: state.masterVolume, output: ctx.destination });
  // Downmix/stereo spread happens through the channel count of the context.
  if (opts.channels === 1) graph.masterIn.channelCount = 1;

  let scheduled = 0;

  state.clips.forEach((clip) => {
    if (clip.muted) return;
    const strip = graph.strips.get(clip.trackId);
    if (!strip) return;
    const rec = buffers.get(clip.bufferId);
    if (!rec) return;
    const track = state.tracks.find((t) => t.id === clip.trackId);
    const rate = Math.max(0.05, clip.speed * (track?.speed ?? 1));
    const pitch = clip.pitch + (track?.pitch ?? 0);
    const buffer = buffers.pitched(clip.bufferId, pitch, 78, 4, opts.sampleRate) ?? rec.buffer;

    const clipStart = Math.max(clip.start, start);
    const clipEnd = Math.min(clip.start + clip.duration, end);
    if (clipEnd <= clipStart) return;

    const srcOffset = clip.offset + (clipStart - clip.start) * rate;
    if (srcOffset >= buffer.duration) return;

    const when = Math.max(0, clipStart - start);
    const localStart = clipStart - clip.start;
    const localEnd = clipEnd - clip.start;
    const clipGain = dbToGain(clip.gainDb);
    const env = (t: number) => {
      let v = clipGain;
      if (clip.fadeIn > 0 && t < clip.fadeIn) v *= Math.max(0, t / clip.fadeIn);
      const tailT = clip.duration - t;
      if (clip.fadeOut > 0 && tailT < clip.fadeOut) v *= Math.max(0, tailT / clip.fadeOut);
      return Math.max(0, Math.min(2, v));
    };

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(env(localStart), when);
    const span = clipEnd - clipStart;
    const steps = Math.max(1, Math.ceil(span * 30));
    for (let i = 1; i <= steps; i++) {
      const t = localStart + ((localEnd - localStart) * i) / steps;
      g.gain.linearRampToValueAtTime(env(t), when + span * (i / steps));
    }
    src.connect(g).connect(strip.input);
    src.start(when, srcOffset, Math.min(span * rate, Math.max(0, buffer.duration - srcOffset)));
    scheduled++;
    opts.onProgress?.(Math.min(0.9, scheduled / Math.max(1, state.clips.length)) * 0.4);
  });

  const rendered = await ctx.startRendering();
  opts.onProgress?.(1);
  return rendered;
}

/** Peak scan used to warn about clipping before export. */
export function peakOf(buffer: AudioBuffer): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i += 3) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}
