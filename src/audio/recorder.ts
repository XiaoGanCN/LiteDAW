/* ============================================================================
   LiteDAW · RECORDER
   Captures microphone / line input as raw Float32 PCM through an AudioWorklet
   (ScriptProcessor fallback for older Android WebViews), so recordings never
   take a codec round-trip and stay at the context's full sample rate.
   ========================================================================= */

import { engine } from './engine';

export interface InputDevice {
  deviceId: string;
  label: string;
}

export interface RecordingResult {
  buffer: AudioBuffer;
  peakLinear: number;
  seconds: number;
}

export class Recorder {
  private stream: MediaStream | null = null;
  private node: AudioNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private monitorGain: GainNode | null = null;
  private chunks: Float32Array[][] = [];
  private frames = 0;
  private recording = false;
  private tapId = 'rec';
  private peak = 0;

  /** Analyser id for the input meter. */
  get meterId() {
    return this.tapId;
  }

  static async listDevices(): Promise<InputDevice[]> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}` }));
    } catch {
      return [];
    }
  }

  async open(deviceId?: string, monitor = false): Promise<void> {
    const ctx = await engine.init();
    await this.close();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 2,
      },
      video: false,
    });

    this.source = ctx.createMediaStreamSource(this.stream);
    this.monitorGain = ctx.createGain();
    this.monitorGain.gain.value = monitor ? 0.7 : 0;
    this.source.connect(this.monitorGain).connect(engine.bus('daw'));
    engine.createTap(this.tapId, this.source, 512);

    if (engine.hasWorklet) {
      const node = new AudioWorkletNode(ctx, 'litedaw-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 2,
      });
      node.port.onmessage = (e: MessageEvent<{ chans: Float32Array[]; frames: number }>) => {
        if (!this.recording) return;
        const { chans, frames } = e.data;
        this.chunks.push(chans);
        this.frames += frames;
        for (const c of chans) {
          for (let i = 0; i < c.length; i += 8) {
            const a = Math.abs(c[i]);
            if (a > this.peak) this.peak = a;
          }
        }
      };
      this.source.connect(node);
      this.node = node;
    } else {
      // Deprecated but universally available fallback.
      const sp = ctx.createScriptProcessor(2048, 2, 2);
      sp.onaudioprocess = (ev) => {
        if (!this.recording) return;
        const chans = [new Float32Array(ev.inputBuffer.getChannelData(0))];
        if (ev.inputBuffer.numberOfChannels > 1) {
          chans.push(new Float32Array(ev.inputBuffer.getChannelData(1)));
        }
        this.chunks.push(chans);
        this.frames += chans[0].length;
        for (const c of chans) {
          for (let i = 0; i < c.length; i += 8) {
            const a = Math.abs(c[i]);
            if (a > this.peak) this.peak = a;
          }
        }
      };
      const sink = ctx.createGain();
      sink.gain.value = 0;
      this.source.connect(sp);
      sp.connect(sink).connect(ctx.destination);
      this.node = sp;
    }
  }

  setMonitor(on: boolean) {
    if (this.monitorGain && engine.ctx) {
      this.monitorGain.gain.setTargetAtTime(on ? 0.7 : 0, engine.ctx.currentTime, 0.02);
    }
  }

  get isOpen() {
    return this.stream !== null;
  }

  get isRecording() {
    return this.recording;
  }

  start() {
    this.chunks = [];
    this.frames = 0;
    this.peak = 0;
    this.recording = true;
  }

  /** Stops capture and materialises the take as an AudioBuffer. */
  stop(): RecordingResult | null {
    this.recording = false;
    const ctx = engine.ctx;
    if (!ctx || this.frames === 0) return null;
    const channels = this.chunks[0]?.length ?? 1;
    const buffer = new AudioBuffer({
      numberOfChannels: channels,
      length: this.frames,
      sampleRate: ctx.sampleRate,
    });
    const writes = new Array(channels).fill(0);
    for (const block of this.chunks) {
      for (let c = 0; c < channels; c++) {
        const src = block[Math.min(c, block.length - 1)];
        buffer.getChannelData(c).set(src, writes[c]);
        writes[c] += src.length;
      }
    }
    const result: RecordingResult = {
      buffer,
      peakLinear: this.peak,
      seconds: buffer.duration,
    };
    this.chunks = [];
    this.frames = 0;
    return result;
  }

  /** Live input level for the record-arm meter. */
  level() {
    return engine.level(this.tapId);
  }

  async close() {
    this.recording = false;
    engine.releaseTap(this.tapId);
    try {
      this.node?.disconnect();
      this.source?.disconnect();
      this.monitorGain?.disconnect();
    } catch {
      /* already detached */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.node = null;
    this.source = null;
    this.monitorGain = null;
    this.chunks = [];
    this.frames = 0;
  }
}

export const recorder = new Recorder();
