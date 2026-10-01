/* ============================================================================
   LiteDAW · AUDIO ENGINE
   One AudioContext for the whole app, three isolated module buses, a shared
   master strip with limiter + analyser, and a metering tap registry.
   ========================================================================= */

export type ModuleBus = 'pitch' | 'bpm' | 'daw' | 'preview';

export interface MeterTap {
  id: string;
  node: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
}

const WORKLET_SRC = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.on = true; this.port.onmessage = (e) => { this.on = !!e.data.recording; }; }
  process(inputs) {
    const input = inputs[0];
    if (this.on && input && input[0] && input[0].length) {
      const chans = input.map((c) => c.slice(0));
      this.port.postMessage({ chans, frames: input[0].length }, chans.map((c) => c.buffer));
    }
    return true;
  }
}
registerProcessor('litedaw-capture', CaptureProcessor);
`;

class Engine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private limiter!: DynamicsCompressorNode;
  private masterAnalyser!: AnalyserNode;
  private masterBuf!: Float32Array<ArrayBuffer>;
  private buses = new Map<ModuleBus, GainNode>();
  private taps = new Map<string, MeterTap>();
  private initPromise: Promise<AudioContext> | null = null;
  private resumeBound = false;
  private workletReady = false;

  /** Subscribers wanting to know when audio actually unlocks. */
  private listeners = new Set<(running: boolean) => void>();
  running = false;

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000;
  }

  get time() {
    return this.ctx?.currentTime ?? 0;
  }

  /** Lazily builds the graph. Safe to call from any gesture handler. */
  async init(): Promise<AudioContext> {
    if (this.ctx) return this.ctx;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0.9;

      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -1.5;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.09;

      this.masterAnalyser = ctx.createAnalyser();
      this.masterAnalyser.fftSize = 4096;
      this.masterAnalyser.smoothingTimeConstant = 0.72;
      this.masterBuf = new Float32Array(this.masterAnalyser.fftSize);

      this.master.connect(this.limiter);
      this.limiter.connect(this.masterAnalyser);
      this.masterAnalyser.connect(ctx.destination);

      // module buses
      (['pitch', 'bpm', 'daw', 'preview'] as ModuleBus[]).forEach((m) => {
        const g = ctx.createGain();
        g.gain.value = m === 'preview' ? 0.55 : 1;
        g.connect(this.master);
        this.buses.set(m, g);
      });

      // PCM capture worklet (recording) — failures are non-fatal.
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        this.workletReady = true;
      } catch {
        this.workletReady = false;
      }

      ctx.onstatechange = () => {
        this.running = ctx.state === 'running';
        this.listeners.forEach((l) => l(this.running));
      };

      if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
      this.running = ctx.state === 'running';
      this.listeners.forEach((l) => l(this.running));
      return ctx;
    })();

    return this.initPromise;
  }

  /** Attaches one-shot unlock handlers to the document (autoplay policy). */
  bindUnlock() {
    if (this.resumeBound) return;
    this.resumeBound = true;
    const unlock = () => {
      void this.init().then((ctx) => {
        if (ctx.state === 'suspended') void ctx.resume();
      });
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
      window.addEventListener(ev, unlock, { passive: true }),
    );
  }

  onRunningChange(cb: (running: boolean) => void) {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  bus(module: ModuleBus): GainNode {
    const b = this.buses.get(module);
    if (!b) throw new Error(`bus ${module} not ready — call engine.init() first`);
    return b;
  }

  get masterIn(): GainNode {
    if (!this.master) throw new Error('engine not initialised');
    return this.master;
  }

  setMasterVolume(v: number) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(Math.max(0, Math.min(1.4, v)), t, 0.02);
  }

  setBusVolume(module: ModuleBus, v: number) {
    const b = this.buses.get(module);
    if (!b || !this.ctx) return;
    b.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /* ── Metering taps ─────────────────────────────────────────────────── */
  createTap(id: string, node: AudioNode, fftSize = 1024): MeterTap {
    const ctx = this.ctx;
    if (!ctx) throw new Error('engine not initialised');
    const an = ctx.createAnalyser();
    an.fftSize = fftSize;
    an.smoothingTimeConstant = 0.55;
    node.connect(an);
    const tap: MeterTap = { id, node: an, buf: new Float32Array(an.fftSize) };
    this.taps.set(id, tap);
    return tap;
  }

  releaseTap(id: string) {
    const t = this.taps.get(id);
    if (!t) return;
    try {
      t.node.disconnect();
    } catch {
      /* already detached */
    }
    this.taps.delete(id);
  }

  /** Reads a smoothed RMS level (0..1-ish) from a tap. */
  level(id: string): number {
    const t = this.taps.get(id);
    if (!t) return 0;
    t.node.getFloatTimeDomainData(t.buf);
    let sum = 0;
    for (let i = 0; i < t.buf.length; i += 2) sum += t.buf[i] * t.buf[i];
    const rms = Math.sqrt(sum / (t.buf.length / 2));
    // map to a display range with a mild expansion so quiet material still reads
    return Math.min(1, Math.pow(rms * 2.6, 0.62));
  }

  masterLevel(): number {
    if (!this.masterAnalyser) return 0;
    this.masterAnalyser.getFloatTimeDomainData(this.masterBuf);
    let sum = 0;
    for (let i = 0; i < this.masterBuf.length; i += 2) sum += this.masterBuf[i] * this.masterBuf[i];
    return Math.min(1, Math.pow(Math.sqrt(sum / (this.masterBuf.length / 2)) * 2.6, 0.62));
  }

  get analyser(): AnalyserNode | null {
    return this.masterAnalyser ?? null;
  }

  get hasWorklet() {
    return this.workletReady;
  }

  /** Builds an offline context that mirrors the realtime master chain. */
  async offline(channels: number, length: number, sampleRate: number): Promise<OfflineAudioContext> {
    const OAC: typeof OfflineAudioContext =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    return new OAC(channels, Math.max(1, Math.ceil(length)), sampleRate);
  }
}

export const engine = new Engine();

/** Downbeat/loop helper shared by the BPM trainer and the DAW transport. */
export const secondsPerBeat = (bpm: number) => 60 / Math.max(1, bpm);
export const beatsToSeconds = (beats: number, bpm: number) => beats * secondsPerBeat(bpm);

export function formatTime(sec: number, withMs = true) {
  if (!Number.isFinite(sec)) sec = 0;
  const neg = sec < 0;
  sec = Math.abs(sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 1000);
  const base = `${m}:${String(s).padStart(2, '0')}`;
  return `${neg ? '-' : ''}${base}${withMs ? `.${String(ms).padStart(3, '0')}` : ''}`;
}

export function formatBarsBeats(beats: number, sig: number, ticksPerBeat = 4) {
  const bar = Math.floor(beats / sig) + 1;
  const beat = Math.floor(beats % sig) + 1;
  const tick = Math.floor((beats % 1) * ticksPerBeat) + 1;
  return `${bar}.${beat}.${tick}`;
}
