/* ============================================================================
   LiteDAW · AUDIO BUFFER REGISTRY
   AudioBuffers are large, mutable-ish and non-serialisable, so they live
   outside the store. Components subscribe to a version counter instead.
   ========================================================================= */

import { peakEnvelope, pitchShiftBuffer, type PeakEnvelope } from '../audio/dsp';

export interface RegisteredBuffer {
  id: string;
  name: string;
  buffer: AudioBuffer;
  sampleRate: number;
  channels: number;
  duration: number;
  frames: number;
  /** Pre-computed min/max envelope for timeline painting. */
  peak: PeakEnvelope;
  /** Cache of pitch-shifted variants, keyed by semitone offset. */
  shifted: Map<number, AudioBuffer>;
  source: string;
  addedAt: number;
}

const PEAK_BUCKETS = 4096;

class BufferRegistry {
  private map = new Map<string, RegisteredBuffer>();
  private listeners = new Set<() => void>();
  version = 0;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  add(name: string, buffer: AudioBuffer, source = 'import'): RegisteredBuffer {
    const id = `buf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    return this.addWithId(id, name, buffer, source);
  }

  /**
   * Registers a buffer under a caller-supplied id. Restoring persisted media
   * needs this: clips already reference the id that was stored alongside the
   * audio, so the id has to survive a reload or every clip would come back
   * unlinked.
   */
  addWithId(id: string, name: string, buffer: AudioBuffer, source = 'import'): RegisteredBuffer {
    const existing = this.map.get(id);
    if (existing) return existing;
    const rec: RegisteredBuffer = {
      id,
      name,
      buffer,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      duration: buffer.duration,
      frames: buffer.length,
      peak: peakEnvelope(buffer.getChannelData(0), PEAK_BUCKETS),
      shifted: new Map(),
      source,
      addedAt: Date.now(),
    };
    this.map.set(id, rec);
    this.emit();
    return rec;
  }

  get(id: string | null | undefined): RegisteredBuffer | null {
    return id ? this.map.get(id) ?? null : null;
  }

  has(id: string) {
    return this.map.has(id);
  }

  all(): RegisteredBuffer[] {
    return [...this.map.values()];
  }

  /** Removes an entry, returning false when clips still reference it. */
  remove(id: string, referencedBy: string[]): boolean {
    if (referencedBy.length) return false;
    const ok = this.map.delete(id);
    if (ok) this.emit();
    return ok;
  }

  /**
   * Returns a pitch-shifted copy of the buffer, memoised per semitone offset.
   * Granular processing is expensive, so it happens once per (clip, pitch).
   */
  pitched(id: string, semitones: number, grainMs = 78, overlap = 4, ctxRate = 48000): AudioBuffer | null {
    const rec = this.map.get(id);
    if (!rec) return null;
    const key = Math.round(semitones * 100);
    if (Math.abs(semitones) < 0.01) return rec.buffer;
    const cached = rec.shifted.get(key);
    if (cached) return cached;

    const src = rec.buffer;
    const out = new AudioBuffer({
      numberOfChannels: src.numberOfChannels,
      length: src.length,
      sampleRate: src.sampleRate || ctxRate,
    });
    for (let c = 0; c < src.numberOfChannels; c++) {
      const shifted = pitchShiftBuffer(src.getChannelData(c), src.sampleRate, semitones, grainMs, overlap);
      out.getChannelData(c).set(shifted.subarray(0, out.length));
    }
    rec.shifted.set(key, out);
    return out;
  }

  clearPitchCache(id?: string) {
    if (id) this.map.get(id)?.shifted.clear();
    else this.map.forEach((r) => r.shifted.clear());
  }

  totalBytes(): number {
    let bytes = 0;
    this.map.forEach((r) => {
      bytes += r.frames * r.channels * 4;
      r.shifted.forEach((b) => {
        bytes += b.length * b.numberOfChannels * 4;
      });
    });
    return bytes;
  }
}

export const buffers = new BufferRegistry();

/** Builds a silent placeholder buffer (used by "add empty clip"). */
export function silentBuffer(seconds: number, channels = 2, sampleRate = 48000) {
  return new AudioBuffer({
    numberOfChannels: channels,
    length: Math.max(1, Math.ceil(seconds * sampleRate)),
    sampleRate,
  });
}
